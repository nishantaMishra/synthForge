"""Run the reviewed deployment CLI from the localhost owner interface."""
import asyncio
import importlib.util
import json
from datetime import datetime, timezone
import os
from pathlib import Path
import sys

from aiohttp import web
from cloud_config import clear_workspace_url, save_workspace_url

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'cloud-infra/deployment.py'
STATE = ROOT / 'runtime/cloud-deployment.json'
LOG = ROOT / 'runtime/cloud-deployment.log'
spec = importlib.util.spec_from_file_location('synth_deployment_tool', SCRIPT)
tool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tool)


class CloudDeployment:
    def __init__(self):
        self.process = None
        self.task = None
        self.action = None
        self.failure = None
        self.lock = asyncio.Lock()

    def snapshot(self):
        try:
            state = json.loads(STATE.read_text())
        except (OSError, ValueError):
            state = {}
        if state.get('status') == 'ready' and state.get('expiresAt'):
            if datetime.now(timezone.utc) >= datetime.fromisoformat(state['expiresAt'].replace('Z', '+00:00')):
                state['status'] = 'expired'
        return {
            'plan': tool.plan(),
            'deployment': {key: state.get(key) for key in ('status', 'url', 'expiresAt')},
            'ownerConfigured': bool(state.get('ownerSub')),
            'running': self.process is not None and self.process.returncode is None,
            'action': self.action, 'failure': self.failure,
            'logPath': str(LOG),
        }

    async def run(self, body):
        async with self.lock:
            return await self._run(body)

    async def _run(self, body):
        if self.process is not None and self.process.returncode is None:
            raise web.HTTPConflict(text='A deployment command is already running.')
        action = body.get('action')
        if action not in ('build', 'deploy', 'enable-owner', 'stop', 'destroy'):
            raise web.HTTPBadRequest(text='Choose a valid deployment action.')
        command = [sys.executable, str(SCRIPT), action]
        if action in ('deploy', 'enable-owner'):
            if body.get('allowAwsCharges') is not True:
                raise web.HTTPBadRequest(text='Review the resources and acknowledge AWS charges before launching or enabling a job.')
            command.append('--allow-aws-charges')
        if action == 'enable-owner':
            email = body.get('ownerEmail')
            if not isinstance(email, str) or len(email) > 320:
                raise web.HTTPBadRequest(text='Enter the email confirmed at the hosted workspace.')
            command += ['--owner-email', email]
        if action == 'destroy':
            if body.get('deleteDemoData') is not True:
                raise web.HTTPBadRequest(text='Confirm deletion of this demo’s files and job records before cleanup.')
            command.append('--delete-demo-data')
        LOG.parent.mkdir(parents=True, exist_ok=True)
        self.failure = None
        self.action = action
        with LOG.open('w') as output:
            os.chmod(LOG, 0o600)
            self.process = await asyncio.create_subprocess_exec(
                *command, cwd=ROOT, stdout=output, stderr=asyncio.subprocess.STDOUT,
                env=dict(os.environ, PYTHONUNBUFFERED='1'), start_new_session=True)
        self.task = asyncio.create_task(self.finish(action, self.process))
        return self.snapshot()

    async def finish(self, action, process):
        code = await process.wait()
        if code:
            self.failure = f'The {action} command failed. See {LOG} for the exact error.'
            return
        state = self.snapshot()['deployment']
        if action in ('deploy', 'enable-owner') and state.get('status') == 'ready' and state.get('url'):
            save_workspace_url(state['url'])
        elif action in ('stop', 'destroy'):
            clear_workspace_url()
