"""Exercise the verification lifecycle with a fixture worker; no external uploads."""
import asyncio
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from verification import Verification, job_id, verification_graph
from aiohttp import web


class VerificationChecks(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        image = self.root / 'ComfyUI/output/final.png'
        image.parent.mkdir(parents=True)
        image.write_bytes(b'original output bytes including metadata')
        self.manager = Verification(SimpleNamespace(), self.root)
        self.identifier = str(uuid4())
        self.run = {'status': {'completed': True, 'status_str': 'success'},
                    'outputs': {'62': {'images': [{'filename': 'final.png', 'subfolder': '', 'type': 'output'}]}}}

        async def history(identifier):
            return self.run
        self.manager.history = history

    async def asyncTearDown(self):
        await self.manager.close()
        self.temp.cleanup()

    async def test_single_pass_preserves_exact_file_and_results(self):
        class Worker:
            returncode = 0
            stdout = asyncio.StreamReader()
            async def wait(self):
                return 0
        worker = Worker()
        worker.stdout.feed_data((json.dumps({'id': 'claude', 'outcome': 'not_detected', 'message': 'No credential found'})+'\n').encode())
        worker.stdout.feed_data((json.dumps({'id': 'openai', 'outcome': 'unavailable', 'message': 'Rate limited'})+'\n').encode())
        worker.stdout.feed_eof()
        calls = []
        async def spawn(*args, **kwargs):
            calls.append(args)
            self.assertEqual(Path(args[-2]).read_bytes(), b'original output bytes including metadata')
            return worker
        async def inline(function, *args):
            return function(*args)
        with patch('verification.asyncio.create_subprocess_exec', spawn), patch('verification.asyncio.to_thread', inline):
            first = self.manager.begin(self.identifier)
            self.assertIs(first, self.manager.begin(self.identifier))
            await self.manager.tasks[self.identifier]
            self.assertIs(first, self.manager.begin(self.identifier))
        self.assertEqual(len(calls), 1)
        self.assertEqual(first['status'], 'complete')
        self.assertEqual([p['outcome'] for p in first['providers']], ['not_detected', 'unavailable', 'manual'])
        self.assertEqual(len(first['sha256']), 64)
        restored = Verification(SimpleNamespace(), self.root).read(self.identifier)
        self.assertEqual(restored, first)

    async def test_failed_generation_never_submits(self):
        self.run['status'] = {'completed': False, 'status_str': 'error'}
        with patch('verification.asyncio.create_subprocess_exec') as spawn:
            report = self.manager.begin(self.identifier)
            await self.manager.tasks[self.identifier]
            spawn.assert_not_called()
        self.assertEqual(report['status'], 'cancelled')

    async def test_output_path_cannot_escape_output_directory(self):
        self.run['outputs']['62']['images'][0]['filename'] = '../../../outside.png'
        report = self.manager.begin(self.identifier)
        await self.manager.tasks[self.identifier]
        self.assertEqual(report['status'], 'error')
        self.assertNotIn('sha256', report)

    async def test_cancel_and_server_restart_do_not_resubmit(self):
        self.run = None
        report = self.manager.begin(self.identifier)
        await asyncio.sleep(0)
        await self.manager.cancel(SimpleNamespace(match_info={'identifier': self.identifier}))
        self.assertEqual(report['status'], 'cancelled')
        self.assertIs(report, self.manager.begin(self.identifier))
        other = str(uuid4())
        interrupted = {**report, 'prompt_id': other, 'status': 'checking'}
        self.manager.save(interrupted)
        restored = Verification(SimpleNamespace(), self.root).read(other)
        self.assertEqual(restored['status'], 'error')

    async def test_invalid_job_identifiers_rejected(self):
        for value in ('../outside', '', None):
            with self.assertRaises(web.HTTPBadRequest):
                job_id(value)

    async def test_graph_connects_checks_after_save_and_marks_google_manual(self):
        graph = verification_graph()
        nodes = {node['id']: node for node in graph['nodes']}
        self.assertEqual(len(nodes), 4)
        self.assertTrue(nodes['verify-google']['manual'])
        self.assertFalse(nodes['verify-claude']['manual'])
        edges = {(edge['from'], edge['to']) for edge in graph['edges']}
        self.assertIn(('62', 'verify-claude'), edges)
        self.assertIn(('verify-claude', 'verify-openai'), edges)
        self.assertIn(('verify-openai', 'verify-report'), edges)
        self.assertNotIn(('verify-google', 'verify-report'), edges)


if __name__ == '__main__':
    unittest.main()
