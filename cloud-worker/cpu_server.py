"""Loopback text API for the cloud worker, using Synth Forge's existing pipeline."""

import sys
from pathlib import Path
from types import SimpleNamespace

import aiohttp
from aiohttp import web

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'studio'))
from text_pipeline import TextStudio


def create_app():
    context = SimpleNamespace(session=None)
    text = TextStudio(context, ROOT)
    app = web.Application(client_max_size=3 * 1024**2)

    async def lifecycle(_app):
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=180)) as session:
            context.session = session
            yield
            await text.close()

    app.cleanup_ctx.append(lifecycle)
    app.router.add_get('/api/text/health', text.health)
    app.router.add_post('/api/text/upload', text.upload)
    app.router.add_post('/api/text/run', text.start)
    app.router.add_get('/api/text/jobs/{identifier}', text.get)
    app.router.add_get('/api/text/jobs/{identifier}/output', text.download)
    app.router.add_post('/api/text/jobs/{identifier}/cancel', text.cancel)
    return app


if __name__ == '__main__':
    web.run_app(create_app(), host='127.0.0.1', port=8190)
