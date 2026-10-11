#!/usr/bin/env python3
"""Prepare or explicitly launch the disposable AWS CPU demo; never store credentials."""

import argparse
from contextlib import contextmanager
import fcntl
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / 'runtime/cloud-deployment.json'
OLLAMA = 'ollama/ollama:0.34.2'
LOCAL_IMAGES = {'web': 'synth-cloud-web:cpu-demo', 'worker': 'synth-cloud-worker:cpu-demo', 'ollama': OLLAMA}


def plan():
    return {
        'mode': 'cpu-text', 'region': 'us-east-1', 'deployed': False,
        'web': 'Next.js on Lambda (512 MB) and API Gateway HTTPS; target throttle 2 requests/second, burst 10',
        'worker': 'One m7i.xlarge (4 vCPUs, 16 GiB), 40 GB encrypted gp3 disk, no inbound ports',
        'model': 'llama3.2:3b on Ollama 0.34.2; CPU only; detector unavailable',
        'identity': 'Cognito email sign-in; job submission restricted to one confirmed owner',
        'storage': 'Private S3 objects expire after 7 days; DynamoDB job records; SQS plus dead-letter queue',
        'limits': 'One job, at most 8 KB input, 15-minute processing limit, stop after 5 idle minutes, 45-minute boot limit',
        'expiry': 'Two hours from launch start: stop worker, block web invocations, stop waking worker',
        'remainingCosts': 'EBS, container images, stored data and scheduled checks remain until cleanup',
        'authorization': 'plan/check/build do not deploy; deploy and enable-owner require --allow-aws-charges',
        'monetization': 'No pricing plan, checkout or payment is activated by this demo',
        'costEstimate': 'Verified 2026-10-11 in us-east-1: CPU $0.2016/hour (about $0.40 for two hours); 40 GB gp3 disk $3.20/month, prorated. IPv4, images and other services add charges. This is an estimate, not a spending cap.',
    }


class Deployment:
    def __init__(self, args):
        self.args = args
        self.base = ['aws', '--region', args.region, '--no-cli-pager']
        if args.profile:
            self.base += ['--profile', args.profile]
        self.state = json.loads(STATE.read_text()) if STATE.exists() else {}

    def aws(self, *args, capture=True):
        command = self.base + list(args)
        if capture:
            completed = subprocess.run(command + ['--output', 'json'], check=True, text=True, capture_output=True)
            return json.loads(completed.stdout) if completed.stdout.strip() else {}
        subprocess.run(command, check=True)

    def save(self):
        STATE.parent.mkdir(parents=True, exist_ok=True)
        temporary = STATE.with_suffix('.tmp')
        temporary.write_text(json.dumps(self.state, indent=2) + '\n')
        temporary.chmod(0o600)
        temporary.replace(STATE)

    @contextmanager
    def lock(self):
        STATE.parent.mkdir(parents=True, exist_ok=True)
        with (STATE.parent / 'cloud-deployment.lock').open('a') as handle:
            try:
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise ValueError('Another deployment command is already running.')
            self.state = json.loads(STATE.read_text()) if STATE.exists() else {}
            yield

    def identity(self):
        account = self.aws('sts', 'get-caller-identity')['Account']
        if self.state and (account != self.state['account'] or self.args.region != self.state['region']):
            raise ValueError('The saved deployment belongs to a different account or region.')
        return account

    def check(self):
        account = self.identity()
        quota = self.aws('service-quotas', 'get-service-quota', '--service-code', 'ec2',
                         '--quota-code', 'L-1216C47A')['Quota']['Value']
        concurrency = self.aws('lambda', 'get-account-settings')['AccountLimit']['ConcurrentExecutions']
        if quota < 4:
            raise ValueError('This region needs at least 4 standard EC2 vCPUs for the CPU demo.')
        if concurrency < 2:
            raise ValueError('This region needs at least 2 concurrent Lambda executions for web and worker control.')
        subprocess.run(['docker', 'info', '--format', '{{.ServerVersion}}'], check=True)
        print(json.dumps({'accountConnected': True, 'region': self.args.region,
                          'standardCpuQuota': quota, 'lambdaConcurrency': concurrency}, indent=2))
        return account

    def build(self):
        subprocess.run(['docker', 'build', '--platform', 'linux/amd64', '--provenance=false',
                        '--target', 'lambda', '-t', LOCAL_IMAGES['web'], str(ROOT / 'cloud-web')], check=True)
        subprocess.run(['docker', 'build', '--platform', 'linux/amd64', '--provenance=false',
                        '-f', str(ROOT / 'cloud-worker/Dockerfile.cpu'), '-t', LOCAL_IMAGES['worker'], str(ROOT)], check=True)
        subprocess.run(['docker', 'pull', '--platform', 'linux/amd64', OLLAMA], check=True)

    def stack(self, component):
        return self.state['prefix'] + '-' + component

    def outputs(self, component):
        result = self.aws('cloudformation', 'describe-stacks', '--stack-name', self.stack(component))
        outputs = {item['OutputKey']: item['OutputValue'] for item in result['Stacks'][0].get('Outputs', [])}
        self.state.setdefault('outputs', {})[component] = outputs
        self.save()
        return outputs

    def deploy_stack(self, component, template, params=None):
        values = params or {}
        command = ['cloudformation', 'deploy', '--stack-name', self.stack(component),
                   '--template-file', str(ROOT / 'cloud-infra' / template),
                   '--capabilities', 'CAPABILITY_IAM', '--no-fail-on-empty-changeset',
                   '--tags', 'Project=SynthForge', 'Purpose=CpuDemo']
        if values:
            command += ['--parameter-overrides'] + [key + '=' + str(value) for key, value in values.items()]
        self.aws(*command, capture=False)
        return self.outputs(component)

    def web_params(self):
        core = self.state['outputs']['core']
        return {
            'ImageUri': self.state['images']['web'], 'AppOrigin': self.state.get('url', 'https://deployment-pending.invalid'),
            'CognitoDomain': core['CognitoDomain'], 'CognitoClientId': core['CognitoClientId'],
            'CognitoUserPoolId': core['CognitoUserPoolId'], 'BucketName': core['BucketName'],
            'BucketArn': core['BucketArn'], 'QueueUrl': core['QueueUrl'], 'QueueArn': core['QueueArn'],
            'JobsTableName': core['JobsTableName'], 'JobsTableArn': core['JobsTableArn'],
            'DemoOwnerSub': self.state.get('ownerSub', ''), 'DemoExpiresAt': self.state['expiresAt'],
        }

    def deploy(self):
        account = self.check()
        if self.state.get('status') == 'deleted':
            archive = STATE.parent / ('cloud-deployment-' + self.state['prefix'] + '.json')
            archive.write_text(json.dumps(self.state, indent=2) + '\n')
            archive.chmod(0o600)
            self.state = {}
        if self.state:
            raise ValueError('A deployment is already recorded. Stop and clean it up before launching another demo.')
        # Build before creating any AWS resources, so a packaging failure costs no AWS compute.
        self.build()
        now = datetime.now(timezone.utc)
        self.state = {
            'account': account, 'region': self.args.region, 'prefix': 'synth-demo-' + uuid4().hex[:8],
            'createdAt': now.isoformat(), 'expiresAt': (now + timedelta(hours=2)).strftime('%Y-%m-%dT%H:%M:%SZ'),
            'status': 'deploying',
        }
        self.save()
        print('Creating the reviewed CPU demo resources. Cleanup state: ' + str(STATE), flush=True)
        registry = self.deploy_stack('registry', 'registry.yaml')
        core = self.deploy_stack('core', 'core.yaml', {'CognitoDomainPrefix': self.state['prefix']})
        registry_host = registry['WebRepositoryUri'].split('/')[0]
        password = subprocess.run(self.base + ['ecr', 'get-login-password'], check=True, text=True, capture_output=True).stdout
        self.state['images'] = {}
        # Isolate the registry credential and delete it after uploading the three images.
        with tempfile.TemporaryDirectory(prefix='synth-docker-auth-') as config:
            env = {**os.environ, 'DOCKER_CONFIG': config}
            subprocess.run(['docker', 'login', '--username', 'AWS', '--password-stdin', registry_host],
                           input=password, text=True, check=True, env=env)
            for key in ('web', 'worker', 'ollama'):
                uri = registry[{'web': 'WebRepositoryUri', 'worker': 'WorkerRepositoryUri', 'ollama': 'OllamaRepositoryUri'}[key]] + ':demo'
                subprocess.run(['docker', 'tag', LOCAL_IMAGES[key], uri], check=True)
                subprocess.run(['docker', 'push', uri], check=True, env=env)
                self.state['images'][key] = uri
                self.save()
        web = self.deploy_stack('web', 'web.yaml', self.web_params())
        self.state['url'] = web['AppUrl'].rstrip('/')
        self.save()
        self.deploy_stack('core', 'core.yaml', {'CognitoDomainPrefix': self.state['prefix'], 'AppOrigin': self.state['url']})
        self.deploy_stack('web', 'web.yaml', self.web_params())
        cpu_params = {key: core[key] for key in ('BucketName', 'BucketArn', 'QueueUrl', 'QueueArn', 'JobsTableName', 'JobsTableArn')}
        cpu_params.update({'WorkerImageUri': self.state['images']['worker'], 'OllamaImageUri': self.state['images']['ollama'],
                           'WebApiId': web['WebApiId'], 'DemoExpiresAt': self.state['expiresAt']})
        self.deploy_stack('cpu', 'cpu-demo.yaml', cpu_params)
        self.state['status'] = 'ready'
        self.save()
        print('Workspace: ' + self.state['url'])
        print('Sign in and verify your email there, then run enable-owner with that email. Job access is closed until then.')
        print('Demo expiry: ' + self.state['expiresAt'] + '. Clean up afterwards to remove storage and scheduled resources.')

    def enable_owner(self):
        self.identity()
        if self.state.get('status') != 'ready':
            raise ValueError('Complete deployment before enabling the owner.')
        if datetime.now(timezone.utc) >= datetime.fromisoformat(self.state['expiresAt'].replace('Z', '+00:00')):
            raise ValueError('The demo has expired. Clean it up before creating a new demo.')
        email = self.args.owner_email
        if not email or not re.fullmatch(r'[^\s"\\@]+@[^\s"\\@]+\.[^\s"\\@]+', email):
            raise ValueError('Provide the verified sign-in email with --owner-email.')
        pool = self.state['outputs']['core']['CognitoUserPoolId']
        users = self.aws('cognito-idp', 'list-users', '--user-pool-id', pool, '--filter', 'email = "' + email + '"')['Users']
        if len(users) != 1 or not users[0]['Enabled'] or users[0]['UserStatus'] != 'CONFIRMED':
            raise ValueError('Create and confirm this account at the hosted workspace first.')
        sub = next(item['Value'] for item in users[0]['Attributes'] if item['Name'] == 'sub')
        if self.state.get('ownerSub') and self.state['ownerSub'] != sub:
            raise ValueError('This one-job demo already belongs to a different owner.')
        self.state['ownerSub'] = sub
        self.save()
        self.deploy_stack('web', 'web.yaml', self.web_params())
        print('One text job is enabled for your confirmed account. Open ' + self.state['url'])

    def stop(self):
        self.identity()
        if not self.state:
            raise ValueError('No deployment is recorded.')
        # Resource lookup also works when creation failed before stack outputs existed.
        for component in ('cpu', 'web'):
            try:
                resources = self.aws('cloudformation', 'describe-stack-resources', '--stack-name', self.stack(component))['StackResources']
            except subprocess.CalledProcessError as error:
                if 'does not exist' in error.stderr:
                    continue
                raise
            for item in resources:
                resource = item.get('PhysicalResourceId')
                if not resource or item.get('ResourceStatus') == 'DELETE_COMPLETE':
                    continue
                if item['ResourceType'] == 'AWS::Events::Rule':
                    self.aws('events', 'disable-rule', '--name', resource)
                elif item['ResourceType'] == 'AWS::EC2::Instance':
                    try:
                        result = self.aws('ec2', 'describe-instances', '--instance-ids', resource)
                    except subprocess.CalledProcessError as error:
                        if 'InvalidInstanceID.NotFound' in error.stderr:
                            continue
                        raise
                    status = result['Reservations'][0]['Instances'][0]['State']['Name']
                    if status == 'pending':
                        self.aws('ec2', 'wait', 'instance-running', '--instance-ids', resource, capture=False)
                        status = 'running'
                    if status == 'running':
                        self.aws('ec2', 'stop-instances', '--instance-ids', resource)
                elif item['LogicalResourceId'] == 'WebApi':
                    self.aws('apigatewayv2', 'update-api', '--api-id', resource, '--disable-execute-api-endpoint')
        self.state['status'] = 'stopped'
        self.save()
        print('Worker wake-up disabled; compute stop requested. Storage remains until cleanup.')

    def destroy(self):
        self.stop()
        core = self.state.get('outputs', {}).get('core', {})
        for component in ('cpu', 'web', 'registry', 'core'):
            self.aws('cloudformation', 'delete-stack', '--stack-name', self.stack(component))
            self.aws('cloudformation', 'wait', 'stack-delete-complete', '--stack-name', self.stack(component), capture=False)
        if self.args.delete_demo_data:
            if core.get('BucketName'):
                self.aws('s3', 'rm', 's3://' + core['BucketName'], '--recursive', capture=False)
                self.aws('s3api', 'delete-bucket', '--bucket', core['BucketName'])
            if core.get('JobsTableName'):
                self.aws('dynamodb', 'delete-table', '--table-name', core['JobsTableName'])
        else:
            print('Retained private bucket and job table: ' + json.dumps({key: core.get(key) for key in ('BucketName', 'JobsTableName')}))
            print('They can incur storage charges. Save these names before removing the local state.')
        self.state['status'] = 'deleted'
        self.state['dataDeleted'] = self.args.delete_demo_data
        self.save()
        print('Demo stacks deleted. The state file remains as a record; archive/remove it before another deployment.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['plan', 'check', 'build', 'deploy', 'enable-owner', 'stop', 'destroy'])
    parser.add_argument('--region', default='us-east-1')
    parser.add_argument('--profile', help='Named AWS CLI profile; credentials stay with AWS CLI')
    parser.add_argument('--allow-aws-charges', action='store_true', help='Explicitly authorize this command to create/enable billable AWS demo resources')
    parser.add_argument('--owner-email', help='Confirmed Cognito sign-in email, for enable-owner')
    parser.add_argument('--delete-demo-data', action='store_true', help='Also irreversibly delete this demo’s retained S3 files and DynamoDB records')
    args = parser.parse_args()
    if args.action == 'plan':
        print(json.dumps(plan(), indent=2))
        return
    if args.action in ('deploy', 'enable-owner') and not args.allow_aws_charges:
        parser.error('This can incur AWS charges. Review plan, then explicitly pass --allow-aws-charges.')
    operation = Deployment(args)
    try:
        if args.action == 'check':
            operation.check()
        else:
            with operation.lock():
                getattr(operation, args.action.replace('-', '_'))()
    except (ValueError, FileNotFoundError, subprocess.CalledProcessError) as error:
        print(str(error), file=sys.stderr)
        if isinstance(error, subprocess.CalledProcessError) and error.stderr:
            print(error.stderr, file=sys.stderr)
        if args.action == 'deploy' and operation.state:
            print('Deployment did not finish. Run stop, then destroy with --delete-demo-data to remove partial resources.', file=sys.stderr)
        raise SystemExit(1)


if __name__ == '__main__':
    main()
