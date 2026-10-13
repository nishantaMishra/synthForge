"""Local routing and image submission checks without inference or network access."""
import json
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from uuid import uuid4

from aiohttp import web
from aiohttp.test_utils import make_mocked_request

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server
from jobs import job_id


class LocalAPI(unittest.IsolatedAsyncioTestCase):
    async def test_pages_and_client_assets_are_not_cached(self):
        async def handler(request):
            return web.Response(text='local asset')
        for path in ['/', '/static/app.js', '/static/index.html']:
            response = await server.local_origin(make_mocked_request('GET', path), handler)
            self.assertEqual(response.headers['Cache-Control'], 'no-store')

    async def test_server_binds_to_localhost_and_removed_routes_return_404(self):
        with patch.object(sys, 'argv', ['server.py', '--external-backend']), patch('server.web.run_app') as run:
            server.main()
        app = run.call_args.args[0]
        self.assertEqual(run.call_args.kwargs['host'], '127.0.0.1')
        for method, path in [('GET', '/api/cloud/status'), ('GET', '/api/cloud/setup/status'),
                             ('POST', '/api/cloud/setup/deployment'), ('POST', '/api/cloud/setup/quota'),
                             ('POST', '/api/cloud/setup/workspace'), ('POST', f'/api/verification/{uuid4()}')]:
            match = await app.router.resolve(make_mocked_request(method, path))
            self.assertEqual(match.http_exception.status, 404, path)
        for path in ['/api/health', '/api/graph', '/api/text/health', '/api/text/graph']:
            match = await app.router.resolve(make_mocked_request('GET', path))
            self.assertIsNone(match.http_exception, path)

    async def test_image_graph_ends_at_local_output(self):
        studio = server.Studio(8191)
        studio.template = {'11': {'class_type': 'LoadImage', 'inputs': {'image': 'input.png'}},
                           '62': {'class_type': 'SaveImage', 'inputs': {'images': ['11', 0]}}}
        graph = json.loads((await studio.graph(None)).text)
        self.assertEqual([node['id'] for node in graph['nodes']], ['11', '62'])
        self.assertEqual(graph['edges'], [{'from': '11', 'to': '62', 'input': 'images'}])

    async def test_image_submission_only_calls_loopback_engine(self):
        studio = server.Studio(8191)
        studio.template = {'11': {'inputs': {}}, '3': {'inputs': {}}, '592': {'inputs': {}},
                           '595': {'inputs': {}}, '62': {'inputs': {}}}
        calls = []
        class Response:
            status = 200
            async def __aenter__(self): return self
            async def __aexit__(self, *args): pass
            async def read(self): return b'{"node_errors":{}}'
        def post(url, **kwargs):
            calls.append((url, kwargs['json']))
            return Response()
        studio.session = SimpleNamespace(post=post)
        identifier = str(uuid4())
        async def body():
            return {'prompt_id': identifier, 'image': 'input.png', 'client_id': 'local-client'}
        response = await studio.run(SimpleNamespace(json=body))
        self.assertEqual(response.status, 200)
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][0], 'http://127.0.0.1:8191/prompt')
        self.assertEqual(calls[0][1]['prompt']['11']['inputs']['image'], 'input.png')

    async def test_shared_job_validation_rejects_paths(self):
        identifier = str(uuid4())
        self.assertEqual(job_id(identifier), identifier)
        for invalid in [None, '../output', 'unverified-user-id']:
            with self.assertRaises(web.HTTPBadRequest):
                job_id(invalid)


if __name__ == '__main__':
    unittest.main()
