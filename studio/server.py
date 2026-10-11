"""Local interface and API adapter for the independent ComfyUI copy."""
import argparse
import asyncio
import json
import os
from pathlib import Path
import signal
import subprocess
from urllib.parse import urlsplit

import aiohttp
from aiohttp import web
from workflow import compile_workflow, describe_graph, make_run
from verification import Verification, job_id, verification_graph
from text_pipeline import TextStudio, text_graph
from cloud_setup import CloudSetup
from cloud_config import workspace_url

ROOT = Path(__file__).resolve().parents[1]
STATIC = Path(__file__).parent / 'static'
WORKFLOW = ROOT / 'studio/workflows/image-reconstruction.json'


def cloud_workspace_url():
    """Expose only an operator-configured web origin, never AWS credentials."""
    return workspace_url()


async def cloud_status(_request):
    url = cloud_workspace_url()
    return web.json_response({'available': bool(url), 'url': url})


@web.middleware
async def local_origin(request, handler):
    origin = request.headers.get('Origin')
    if request.headers.get('Sec-Fetch-Site') == 'cross-site' or (origin and urlsplit(origin).netloc != request.host):
        raise web.HTTPForbidden(text='Open Synth Forge directly on its localhost address.')
    return await handler(request)


class Studio:
    def __init__(self, backend_port):
        self.url = f'http://127.0.0.1:{backend_port}'
        self.session = None
        self.template = None
        self.child = None
        self.workflow = json.loads(WORKFLOW.read_text())
        self.verification = Verification(self, ROOT)
        self.text = TextStudio(self, ROOT)

    async def start(self, app):
        self.session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=180))

    async def close(self, app):
        await self.verification.close()
        await self.text.close()
        await self.session.close()

    async def registry(self):
        async with self.session.get(self.url + '/object_info') as response:
            return await response.json()

    async def health(self, request):
        try:
            async with self.session.get(self.url + '/system_stats', timeout=aiohttp.ClientTimeout(total=3)) as response:
                stats = await response.json()
            if self.template is None:
                self.template = compile_workflow(self.workflow, await self.registry())
            return web.json_response({'ready': True, 'devices': stats['devices'], 'nodes': len(self.template), 'verification': True})
        except (aiohttp.ClientError, asyncio.TimeoutError) as error:
            if self.child is not None and self.child.poll() is not None:
                return web.json_response({'ready': False, 'message': 'Image engine stopped. Check logs/engine.log. If it reports a fatal CUDA error, reboot before starting again.'})
            return web.json_response({'ready': False, 'message': 'Image engine is starting. Please wait.', 'detail': str(error)})
        except (ValueError, KeyError) as error:
            return web.json_response({'ready': False, 'message': str(error)})

    async def graph(self, request):
        if self.template is None:
            self.template = compile_workflow(self.workflow, await self.registry())
        graph = describe_graph(self.template)
        checks = verification_graph()
        graph['nodes'].extend(checks['nodes'])
        graph['edges'].extend(checks['edges'])
        return web.json_response(graph)

    async def run(self, request):
        body = await request.json()
        identifier = job_id(body.get('prompt_id'))
        if self.template is None:
            self.template = compile_workflow(self.workflow, await self.registry())
        image = body.get('image')
        if not isinstance(image, str) or not image:
            raise web.HTTPBadRequest(text='Upload an image first.')
        settings = body.get('settings', {})
        try:
            level = int(settings.get('adaptive_level', 6))
            low = float(settings.get('denoise_min', 0.08))
            high = float(settings.get('denoise_max', 0.15))
            if not 1 <= level <= 10 or not 0 <= low <= high <= 1:
                raise ValueError('Use level 1–10 and a denoise range between 0 and 1.')
        except (TypeError, ValueError) as error:
            raise web.HTTPBadRequest(text=str(error))
        prompt = make_run(self.template, image, {'adaptive_level': level, 'denoise_min': low, 'denoise_max': high})
        payload = {'prompt': prompt, 'client_id': body['client_id'], 'prompt_id': identifier,
                   'extra_data': {'extra_pnginfo': {'workflow': self.workflow}}}
        async with self.session.post(self.url + '/prompt', json=payload) as response:
            result = await response.read()
            if response.status == 200:
                self.verification.begin(identifier)
            return web.Response(body=result, status=response.status, content_type='application/json')

    async def proxy(self, request):
        route = request.match_info['route']
        if not (route in ('upload/image', 'view', 'system_stats') or route.startswith('history/') or route.startswith('api/jobs/')):
            raise web.HTTPNotFound()
        # ComfyUI permits inline SVG only for image requests. Preserve the browser's
        # destination header so its image-safe response branch can run.
        headers = {name: request.headers[name] for name in ('Content-Type', 'Sec-Fetch-Dest') if name in request.headers}
        async with self.session.request(request.method, self.url + '/' + route, params=request.query,
                                        data=await request.read(), headers=headers) as response:
            response_headers = {name: response.headers[name] for name in (
                'Content-Type', 'Content-Disposition', 'X-Content-Type-Options',
                'Vary', 'Cache-Control', 'Content-Security-Policy') if name in response.headers}
            return web.Response(body=await response.read(), status=response.status, headers=response_headers)

    async def socket(self, request):
        ws = web.WebSocketResponse(heartbeat=20)
        await ws.prepare(request)
        try:
            async with self.session.ws_connect(self.url + '/ws', params=request.query, heartbeat=20) as upstream:
                async def outgoing():
                    async for message in ws:
                        if message.type == aiohttp.WSMsgType.TEXT:
                            await upstream.send_str(message.data)
                        elif message.type == aiohttp.WSMsgType.BINARY:
                            await upstream.send_bytes(message.data)
                    await upstream.close()

                async def incoming():
                    async for message in upstream:
                        if message.type == aiohttp.WSMsgType.TEXT:
                            await ws.send_str(message.data)
                        elif message.type == aiohttp.WSMsgType.BINARY:
                            await ws.send_bytes(message.data)
                    await ws.close()

                await asyncio.gather(outgoing(), incoming())
        except (aiohttp.ClientError, ConnectionResetError):
            await ws.close()
        return ws


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8190)
    parser.add_argument('--backend-port', type=int, default=8191)
    parser.add_argument('--external-backend', action='store_true', help='For local testing against an already-running copy')
    parser.add_argument('--cpu', action='store_true')
    args = parser.parse_args()
    logs = ROOT / 'logs'
    logs.mkdir(exist_ok=True)
    child = None
    if not args.external_backend:
        command = [str(ROOT / 'ComfyUI/.venv/bin/python'), 'main.py', '--listen', '127.0.0.1',
                   '--port', str(args.backend_port), '--preview-method', 'auto']
        if args.cpu:
            command.append('--cpu')
        child = subprocess.Popen(command, cwd=ROOT / 'ComfyUI', stdout=(logs / 'engine.log').open('ab'),
                                 stderr=subprocess.STDOUT, start_new_session=True)
    studio = Studio(args.backend_port)
    cloud_setup = CloudSetup()
    studio.child = child
    app = web.Application(client_max_size=100 * 1024**2, middlewares=[local_origin])
    app.on_startup.append(studio.start)
    app.on_cleanup.append(studio.close)
    app.router.add_get('/', lambda request: web.FileResponse(STATIC / 'index.html'))
    app.router.add_get('/api/health', studio.health)
    app.router.add_get('/api/cloud/status', cloud_status)
    app.router.add_get('/api/cloud/setup/status', cloud_setup.status)
    app.router.add_get('/api/cloud/setup/deployment', cloud_setup.deployment_status)
    app.router.add_post('/api/cloud/setup/deployment', cloud_setup.deployment_action)
    app.router.add_post('/api/cloud/setup/quota', cloud_setup.request_quota)
    app.router.add_post('/api/cloud/setup/workspace', cloud_setup.save_workspace)
    app.router.add_get('/api/graph', studio.graph)
    app.router.add_post('/api/run', studio.run)
    app.router.add_get('/api/text/health', studio.text.health)
    app.router.add_get('/api/text/graph', lambda request: web.json_response(text_graph()))
    app.router.add_post('/api/text/upload', studio.text.upload)
    app.router.add_get('/api/text/uploads/{identifier}', studio.text.get_input)
    app.router.add_post('/api/text/run', studio.text.start)
    app.router.add_get('/api/text/jobs/{identifier}', studio.text.get)
    app.router.add_get('/api/text/jobs/{identifier}/preview', studio.text.preview)
    app.router.add_get('/api/text/jobs/{identifier}/output', studio.text.download)
    app.router.add_post('/api/text/jobs/{identifier}/cancel', studio.text.cancel)
    app.router.add_get('/api/verification/{identifier}', studio.verification.get)
    app.router.add_post('/api/verification/{identifier}', studio.verification.start)
    app.router.add_post('/api/verification/{identifier}/cancel', studio.verification.cancel)
    app.router.add_get('/api/verification/{identifier}/{provider}.png', studio.verification.evidence)
    app.router.add_get('/comfy/ws', studio.socket)
    app.router.add_route('*', '/comfy/{route:.*}', studio.proxy)
    app.router.add_static('/static/', STATIC)
    try:
        web.run_app(app, host='127.0.0.1', port=args.port)
    finally:
        if child is not None and child.poll() is None:
            child.send_signal(signal.SIGTERM)
            try:
                child.wait(timeout=15)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()


if __name__ == '__main__':
    main()
