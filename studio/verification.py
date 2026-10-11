"""Persist a single verification pass for each successfully generated image."""
import asyncio
import hashlib
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID

from aiohttp import web

PROVIDERS = [
    {'id': 'claude', 'name': 'Claude', 'url': 'https://claude.com/check-files'},
    {'id': 'openai', 'name': 'OpenAI', 'url': 'https://openai.com/research/verify/'},
    {'id': 'google', 'name': 'Google SynthID', 'url': 'https://synthid.com/'},
]
TERMINAL = {'complete', 'cancelled', 'error'}


def verification_graph():
    """Studio stages follow the saved image; these are outside ComfyUI inference."""
    nodes = [{
        'id': 'verify-' + provider['id'], 'type': 'ProviderVerification',
        'label': 'Check ' + provider['name'], 'tool': provider['name'], 'stage': 6,
        'description': ('Download the final image and check it on Google SynthID manually. This step does not delay the automatic run.'
                        if provider['id'] == 'google' else
                        'Check the exact saved output once using the provider’s official file checker.'),
        'manual': provider['id'] == 'google', 'details': {'url': provider['url'], 'mode': 'manual' if provider['id'] == 'google' else 'automatic'},
    } for provider in PROVIDERS]
    nodes.append({'id': 'verify-report', 'type': 'VerificationReport', 'label': 'Save verification report',
                  'tool': 'Synth Forge', 'stage': 7,
                  'description': 'Save provider responses and captured results for the final image, then end the run.',
                  'details': {'retries': 0, 'automatic_regeneration': False}})
    return {'nodes': nodes, 'edges': [
        {'from': '62', 'to': 'verify-claude', 'input': 'final image'},
        {'from': 'verify-claude', 'to': 'verify-openai', 'input': 'next check'},
        {'from': '62', 'to': 'verify-google', 'input': 'manual check', 'manual': True},
        {'from': 'verify-openai', 'to': 'verify-report', 'input': 'provider results'},
    ]}


def timestamp():
    return datetime.now(timezone.utc).isoformat()


def job_id(value):
    try:
        return str(UUID(value))
    except (ValueError, TypeError, AttributeError):
        raise web.HTTPBadRequest(text='Invalid job ID.')


class Verification:
    def __init__(self, studio, root):
        self.studio = studio
        self.root = root
        self.directory = root / 'logs/verification'
        self.tasks = {}
        self.reports = {}
        self.lock = asyncio.Lock()

    def save(self, report):
        directory = self.directory / report['prompt_id']
        directory.mkdir(parents=True, exist_ok=True)
        temporary = directory / 'report.tmp'
        temporary.write_text(json.dumps(report, indent=2))
        temporary.replace(directory / 'report.json')

    def read(self, identifier):
        if identifier not in self.reports:
            file = self.directory / identifier / 'report.json'
            if file.exists():
                report = json.loads(file.read_text())
                # Never silently resubmit a file after an interrupted server run.
                if report['status'] not in TERMINAL:
                    report.update(status='error', message='Synth Forge restarted before checks finished. Use the provider links to check manually.', finished_at=timestamp())
                    for provider in report['providers']:
                        if provider['outcome'] in ('pending', 'checking'):
                            provider.update(outcome='unavailable', message=report['message'])
                    self.save(report)
                self.reports[identifier] = report
        return self.reports.get(identifier)

    def begin(self, identifier):
        identifier = job_id(identifier)
        report = self.read(identifier)
        if report:
            return report
        report = {'prompt_id': identifier, 'status': 'waiting_image', 'started_at': timestamp(),
                  'providers': [{**provider, 'outcome': 'pending', 'message': 'Waiting for the final image.'} for provider in PROVIDERS]}
        report['providers'][2].update(outcome='manual', message='Google’s portal prohibits automated submissions. Download the final image and check it on SynthID manually.')
        self.reports[identifier] = report
        self.save(report)
        self.tasks[identifier] = asyncio.create_task(self.run(report))
        return report

    async def history(self, identifier):
        async with self.studio.session.get(self.studio.url + '/history/' + identifier) as response:
            response.raise_for_status()
            return (await response.json()).get(identifier)

    async def run(self, report):
        identifier = report['prompt_id']
        process = None
        try:
            async with asyncio.timeout(24 * 3600):
                while True:
                    run = await self.history(identifier)
                    if run and (run.get('status', {}).get('completed') or run.get('status', {}).get('status_str') == 'error'):
                        break
                    await asyncio.sleep(2)
            if run['status']['status_str'] != 'success':
                report.update(status='cancelled', message='Image generation did not succeed; no file was submitted.')
                return
            final = run.get('outputs', {}).get('62', {}).get('images', [None])[0]
            if not final or final.get('type') != 'output':
                raise ValueError('The completed job has no final output image.')
            output_directory = (self.root / 'ComfyUI/output').resolve()
            image = (output_directory / final.get('subfolder', '') / final['filename']).resolve()
            if not image.is_relative_to(output_directory) or not image.is_file():
                raise ValueError('Final image is unavailable in this installation’s output directory.')
            directory = self.directory / identifier
            # Keep an exact-byte snapshot so all providers check the same immutable output.
            snapshot = directory / ('image' + image.suffix)
            await asyncio.to_thread(shutil.copyfile, image, snapshot)
            digest = await asyncio.to_thread(lambda: hashlib.sha256(snapshot.read_bytes()).hexdigest())
            report.update(output=final, sha256=digest, status='checking', message='Checking the final image with Claude and OpenAI.')
            self.save(report)
            # Serialize browser passes across jobs; no retries or generation feedback loop.
            async with self.lock:
                node = shutil.which('node')
                if not node:
                    raise ValueError('Node.js is required for the provider verification browser.')
                process = await asyncio.create_subprocess_exec(node, str(Path(__file__).with_name('verify-sites.cjs')),
                    str(snapshot), str(directory), stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
                async with asyncio.timeout(180):
                    async for line in process.stdout:
                        result = json.loads(line)
                        provider = next(p for p in report['providers'] if p['id'] == result['id'])
                        provider.update(result, checked_at=timestamp())
                        self.save(report)
                    if await process.wait() != 0:
                        raise ValueError('The verification browser stopped before finishing.')
            for provider in report['providers']:
                if provider['outcome'] in ('pending', 'checking'):
                    provider.update(outcome='unavailable', message='The provider did not return a result.')
            report.update(status='complete', message='Verification pass finished. Google SynthID requires a manual check.')
        except asyncio.CancelledError:
            report.update(status='cancelled', message='Verification stopped. The generated image is still available.')
        except Exception as error:
            report.update(status='error', message=str(error) or 'Verification timed out.')
        finally:
            if process and process.returncode is None:
                process.terminate()
                try:
                    await asyncio.wait_for(process.wait(), 5)
                except asyncio.TimeoutError:
                    process.kill()
                    await process.wait()
            for provider in report['providers']:
                if provider['outcome'] in ('pending', 'checking'):
                    provider.update(outcome='cancelled' if report['status'] == 'cancelled' else 'unavailable', message=report.get('message', 'Check did not finish.'))
            report['finished_at'] = timestamp()
            self.save(report)
            self.tasks.pop(identifier, None)

    async def get(self, request):
        report = self.read(job_id(request.match_info['identifier']))
        if not report:
            raise web.HTTPNotFound(text='No verification report for this run.')
        return web.json_response(report)

    async def start(self, request):
        identifier = job_id(request.match_info['identifier'])
        if self.read(identifier):
            return web.json_response(self.read(identifier))
        run = await self.history(identifier)
        if not run:
            raise web.HTTPNotFound(text='The image engine has no record of this run.')
        return web.json_response(self.begin(identifier))

    async def cancel(self, request):
        identifier = job_id(request.match_info['identifier'])
        task = self.tasks.get(identifier)
        if task:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
            report = self.reports[identifier]
            if report['status'] not in TERMINAL:
                report.update(status='cancelled', message='Verification stopped.', finished_at=timestamp())
                self.save(report)
            self.tasks.pop(identifier, None)
        return web.json_response({'cancelled': bool(task)})

    async def evidence(self, request):
        identifier = job_id(request.match_info['identifier'])
        provider = request.match_info['provider']
        if provider not in ('claude', 'openai'):
            raise web.HTTPNotFound()
        return web.FileResponse(self.directory / identifier / (provider + '.png'))

    async def close(self):
        tasks = list(self.tasks.values())
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
