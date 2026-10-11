"""Read-only AWS setup checks and an explicit GPU quota request for local owners."""
import asyncio
import json
import os
import secrets
import shutil
from urllib.parse import urlsplit

from aiohttp import web
from cloud_config import save_workspace_url, workspace_url
from cloud_deployment import CloudDeployment


REGION = 'us-east-1'
GPU_QUOTA_CODE = 'L-DB2E81BA'  # Running On-Demand G and VT instances.
GPU_QUOTA_TARGET = 4
CPU_QUOTA_CODE = 'L-1216C47A'  # Running On-Demand Standard instances.


def _owner_request(request):
    if urlsplit('http://' + request.host).hostname not in ('127.0.0.1', 'localhost'):
        raise web.HTTPForbidden(text='Open the owner setup page on localhost.')


async def _aws(*args):
    executable = shutil.which('aws')
    if not executable:
        return None, 'AWS CLI is not installed.'
    env = dict(os.environ, AWS_PAGER='', AWS_DEFAULT_REGION=REGION)
    try:
        process = await asyncio.create_subprocess_exec(
            executable, *args, '--region', REGION, '--output', 'json', '--no-cli-pager',
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, env=env,
        )
        stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=20)
    except asyncio.TimeoutError:
        process.kill()
        await process.communicate()
        return None, 'AWS did not respond in time.'
    except OSError:
        return None, 'AWS CLI could not start.'
    if process.returncode:
        # CLI errors can include account details. Keep them out of the browser.
        error = stderr.decode(errors='replace')
        if any(marker in error for marker in ('ExpiredToken', 'InvalidClientTokenId', 'Unable to locate credentials',
                                              'login required', 'Please reauthenticate', 'AccessDenied')):
            return None, 'AWS sign-in or permission is required.'
        return None, 'AWS could not complete this check. See the terminal for details.'
    try:
        return json.loads(stdout), None
    except json.JSONDecodeError:
        return None, 'AWS returned an unreadable response.'


class CloudSetup:
    def __init__(self):
        self.csrf = secrets.token_urlsafe(32)
        self.deployment = CloudDeployment()

    async def deployment_status(self, request):
        _owner_request(request)
        return web.json_response({**self.deployment.snapshot(), 'csrf': self.csrf},
                                 headers={'Cache-Control': 'no-store'})

    async def deployment_action(self, request):
        _owner_request(request)
        origin = request.headers.get('Origin', '')
        if urlsplit(origin).netloc != request.host or request.headers.get('X-Synth-Setup') != self.csrf:
            raise web.HTTPForbidden(text='Open the setup page directly in Synth Forge.')
        if request.content_type != 'application/json':
            raise web.HTTPBadRequest(text='Expected JSON.')
        try:
            body = await request.json()
        except ValueError:
            raise web.HTTPBadRequest(text='Expected JSON.')
        if not isinstance(body, dict):
            raise web.HTTPBadRequest(text='Expected a deployment action.')
        return web.json_response(await self.deployment.run(body), status=202)

    async def status(self, request):
        _owner_request(request)
        response = {
            'region': REGION, 'quotaTarget': GPU_QUOTA_TARGET,
            'workspaceUrl': workspace_url(),
            'signedIn': False, 'account': None, 'identity': None,
            'quota': None, 'quotaRequest': None, 'quotaError': None,
            'cpuQuota': None, 'cpuQuotaError': None,
            'csrf': self.csrf,
        }
        identity, error = await _aws('sts', 'get-caller-identity')
        if error:
            response['authError'] = error
            return web.json_response(response)
        arn = identity.get('Arn', '')
        label = arn.rsplit('/', 1)[-1] if '/' in arn else arn.rsplit(':', 1)[-1]
        response.update(signedIn=True, account=identity.get('Account'), identity=label)
        cpu_quota, cpu_error = await _aws('service-quotas', 'get-service-quota',
                                          '--service-code', 'ec2', '--quota-code', CPU_QUOTA_CODE)
        if cpu_error:
            response['cpuQuotaError'] = cpu_error
        else:
            response['cpuQuota'] = cpu_quota.get('Quota', {}).get('Value')
        quota, error = await _aws('service-quotas', 'get-service-quota',
                                  '--service-code', 'ec2', '--quota-code', GPU_QUOTA_CODE)
        if error:
            response['quotaError'] = error
        else:
            response['quota'] = quota.get('Quota', {}).get('Value')
        history, error = await _aws('service-quotas', 'list-requested-service-quota-change-history-by-quota',
                                    '--service-code', 'ec2', '--quota-code', GPU_QUOTA_CODE)
        if not error:
            requests = history.get('RequestedQuotas', [])
            if requests:
                latest = max(requests, key=lambda item: item.get('Created') or 0)
                response['quotaRequest'] = {
                    'status': latest.get('Status'), 'desired': latest.get('DesiredValue'),
                }
        elif not response['quotaError']:
            response['quotaError'] = error
        return web.json_response(response)

    async def request_quota(self, request):
        _owner_request(request)
        origin = request.headers.get('Origin', '')
        if urlsplit(origin).netloc != request.host or request.headers.get('X-Synth-Setup') != self.csrf:
            raise web.HTTPForbidden(text='Open the setup page directly in Synth Forge.')
        if request.content_type != 'application/json':
            raise web.HTTPBadRequest(text='Expected JSON.')
        body = await request.json()
        if body != {'desiredVcpus': GPU_QUOTA_TARGET}:
            raise web.HTTPBadRequest(text='This demo only requests four GPU vCPUs.')
        identity, error = await _aws('sts', 'get-caller-identity')
        if error or not identity:
            raise web.HTTPUnauthorized(text='Sign in to AWS first.')
        quota, error = await _aws('service-quotas', 'get-service-quota',
                                  '--service-code', 'ec2', '--quota-code', GPU_QUOTA_CODE)
        if error:
            raise web.HTTPConflict(text='Could not verify the current quota.')
        if quota.get('Quota', {}).get('Value', 0) >= GPU_QUOTA_TARGET:
            return web.json_response({'message': 'GPU quota is already sufficient.'})
        history, error = await _aws('service-quotas', 'list-requested-service-quota-change-history-by-quota',
                                    '--service-code', 'ec2', '--quota-code', GPU_QUOTA_CODE)
        if error:
            raise web.HTTPConflict(text='Could not check existing quota requests.')
        if any(item.get('Status') in ('PENDING', 'CASE_OPENED', 'APPROVED') and
               item.get('DesiredValue', 0) >= GPU_QUOTA_TARGET
               for item in history.get('RequestedQuotas', [])):
            return web.json_response({'message': 'A request for this GPU quota already exists.'})
        result, error = await _aws('service-quotas', 'request-service-quota-increase',
                                   '--service-code', 'ec2', '--quota-code', GPU_QUOTA_CODE,
                                   '--desired-value', str(GPU_QUOTA_TARGET))
        if error:
            raise web.HTTPBadGateway(text='AWS did not accept the quota request. Check Service Quotas in the AWS Console.')
        return web.json_response({'message': 'Quota request submitted. AWS will decide whether to approve it.',
                                  'status': result.get('RequestedQuota', {}).get('Status')})

    async def save_workspace(self, request):
        _owner_request(request)
        origin = request.headers.get('Origin', '')
        if urlsplit(origin).netloc != request.host or request.headers.get('X-Synth-Setup') != self.csrf:
            raise web.HTTPForbidden(text='Open the setup page directly in Synth Forge.')
        if request.content_type != 'application/json':
            raise web.HTTPBadRequest(text='Expected JSON.')
        body = await request.json()
        try:
            url = save_workspace_url(body.get('url'))
        except (AttributeError, ValueError) as error:
            raise web.HTTPBadRequest(text=str(error))
        return web.json_response({'url': url, 'message': 'Cloud workspace address saved on this device.'})
