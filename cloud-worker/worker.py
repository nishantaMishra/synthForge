"""Run owned SQS jobs against the loopback Synth Forge API on an EC2 worker."""

import json
import logging
import os
from pathlib import Path
import tempfile
import time

import boto3
from botocore.exceptions import ClientError
import requests

LOG = logging.getLogger('synth-cloud-worker')
logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')

REGION = os.environ['AWS_REGION']
QUEUE_URL = os.environ['CLOUD_QUEUE_URL']
TABLE = os.environ['CLOUD_JOBS_TABLE']
BUCKET = os.environ['CLOUD_BUCKET']
INSTANCE_ID = os.environ['CLOUD_INSTANCE_ID']
STUDIO = os.environ.get('STUDIO_URL', 'http://127.0.0.1:8190').rstrip('/')
IDLE_SECONDS = int(os.environ.get('CLOUD_IDLE_SECONDS', '300'))
JOB_SECONDS = int(os.environ.get('CLOUD_JOB_SECONDS', '3600'))
START_SECONDS = int(os.environ.get('CLOUD_START_SECONDS', '600'))
COMPUTE_MODE = os.environ.get('CLOUD_COMPUTE_MODE', 'gpu').strip().lower()

s3 = boto3.client('s3', region_name=REGION)
sqs = boto3.client('sqs', region_name=REGION)
ec2 = boto3.client('ec2', region_name=REGION)
table = boto3.resource('dynamodb', region_name=REGION).Table(TABLE)
http = requests.Session()


def update(job_id, status, **fields):
    names = {'#status': 'status'}
    values = {':status': status}
    setters = ['#status = :status']
    for index, (key, value) in enumerate(fields.items()):
        names[f'#field{index}'] = key
        values[f':field{index}'] = value
        setters.append(f'#field{index} = :field{index}')
    table.update_item(Key={'id': job_id}, UpdateExpression='SET ' + ', '.join(setters),
                      ExpressionAttributeNames=names, ExpressionAttributeValues=values)


def get_json(method, path, **kwargs):
    response = http.request(method, STUDIO + path, timeout=60, **kwargs)
    response.raise_for_status()
    return response.json()


def claim(job_id):
    try:
        table.update_item(Key={'id': job_id},
                          UpdateExpression='SET #status = :running, startedAt = :now',
                          ConditionExpression='#status = :queued',
                          ExpressionAttributeNames={'#status': 'status'},
                          ExpressionAttributeValues={':running': 'RUNNING', ':queued': 'QUEUED', ':now': int(time.time())})
        return True
    except ClientError as error:
        if error.response['Error']['Code'] == 'ConditionalCheckFailedException':
            return False
        raise


def wait_for_text(job_id, deadline):
    while time.monotonic() < deadline:
        result = get_json('GET', f'/api/text/jobs/{job_id}')
        if result['status'] == 'complete':
            response = http.get(STUDIO + f'/api/text/jobs/{job_id}/output', timeout=60)
            response.raise_for_status()
            return response.content, 'text/plain', '.txt'
        if result['status'] in ('error', 'cancelled'):
            raise RuntimeError(result.get('message', 'Text processing failed'))
        time.sleep(5)
    raise TimeoutError('Text processing timed out')


def wait_for_image(job_id, deadline):
    while time.monotonic() < deadline:
        history = get_json('GET', f'/comfy/history/{job_id}').get(job_id)
        if history:
            for output in history.get('outputs', {}).values():
                for image in output.get('images', []):
                    params = {'filename': image['filename'], 'subfolder': image.get('subfolder', ''),
                              'type': image.get('type', 'output')}
                    response = http.get(STUDIO + '/comfy/view', params=params, timeout=60)
                    response.raise_for_status()
                    return response.content, response.headers.get('content-type', 'image/png'), '.png'
            status = history.get('status', {})
            if status.get('completed') is False:
                raise RuntimeError('Image processing failed')
        time.sleep(5)
    raise TimeoutError('Image processing timed out')


def process(job):
    job_id, user_id = job['id'], job['userId']
    input_key = job['inputKey']
    if not input_key.startswith(f'input/{user_id}/'):
        raise ValueError('Input ownership mismatch')
    with tempfile.TemporaryDirectory(prefix='synth-cloud-') as directory:
        input_file = Path(directory) / Path(input_key).name
        s3.download_file(BUCKET, input_key, str(input_file))
        deadline = time.monotonic() + JOB_SECONDS
        if job['kind'] == 'text':
            with input_file.open('rb') as source:
                uploaded = get_json('POST', '/api/text/upload', files={'file': (input_file.name, source, 'text/plain')})
            options = job['options']
            started = get_json('POST', '/api/text/run', json={
                'input_id': uploaded['id'], 'model': options['model'], 'edit_limit': options['editLimit']})
            try:
                output, content_type, suffix = wait_for_text(started['id'], deadline)
            except Exception:
                try:
                    get_json('POST', f"/api/text/jobs/{started['id']}/cancel")
                except requests.RequestException:
                    LOG.exception('Could not cancel the interrupted text job')
                raise
        elif job['kind'] == 'image':
            if COMPUTE_MODE == 'cpu-text':
                raise ValueError('Image jobs are unavailable in the CPU text demo')
            with input_file.open('rb') as source:
                uploaded = get_json('POST', '/comfy/upload/image', files={'image': (input_file.name, source)},
                                    data={'type': 'input', 'subfolder': 'cloud', 'overwrite': 'false'})
            options = job['options']
            image_name = f"{uploaded.get('subfolder', '')}/{uploaded['name']}".lstrip('/')
            get_json('POST', '/api/run', json={'image': image_name, 'client_id': job_id, 'prompt_id': job_id,
                                              'settings': {'adaptive_level': options['adaptiveLevel'],
                                                           'denoise_min': options['denoiseMin'],
                                                           'denoise_max': options['denoiseMax']}})
            output, content_type, suffix = wait_for_image(job_id, deadline)
        else:
            raise ValueError('Unsupported job kind')
        key = f'output/{user_id}/{job_id}{suffix}'
        s3.put_object(Bucket=BUCKET, Key=key, Body=output, ContentType=content_type,
                      ServerSideEncryption='AES256')
        update(job_id, 'SUCCEEDED', outputKey=key, finishedAt=int(time.time()))


def queue_depth():
    result = sqs.get_queue_attributes(QueueUrl=QUEUE_URL, AttributeNames=['ApproximateNumberOfMessages'])
    return int(result['Attributes'].get('ApproximateNumberOfMessages', '0'))


def main():
    if not 60 <= JOB_SECONDS <= 43000 or IDLE_SECONDS < 60 or START_SECONDS < 60:
        raise ValueError('Set job, idle, and startup time limits to valid positive values')
    if COMPUTE_MODE not in ('gpu', 'cpu-text'):
        raise ValueError('CLOUD_COMPUTE_MODE must be gpu or cpu-text')
    startup_deadline = time.monotonic() + START_SECONDS
    health_path = '/api/text/health' if COMPUTE_MODE == 'cpu-text' else '/api/health'
    while True:
        try:
            if get_json('GET', health_path).get('ready'):
                break
        except requests.RequestException:
            pass
        if time.monotonic() >= startup_deadline:
            LOG.error('Synth Forge did not become ready; failing pending jobs and stopping EC2 worker')
            while True:
                waiting = sqs.receive_message(QueueUrl=QUEUE_URL, MaxNumberOfMessages=10,
                                              WaitTimeSeconds=0).get('Messages', [])
                if not waiting:
                    break
                for message in waiting:
                    try:
                        job_id = json.loads(message['Body'])['jobId']
                        item = table.get_item(Key={'id': job_id}, ConsistentRead=True).get('Item')
                        if item and item['status'] == 'QUEUED':
                            update(job_id, 'FAILED', failure='Cloud engine did not start', finishedAt=int(time.time()))
                        sqs.delete_message(QueueUrl=QUEUE_URL, ReceiptHandle=message['ReceiptHandle'])
                    except Exception:
                        LOG.exception('Could not fail queued job after startup timeout')
            ec2.stop_instances(InstanceIds=[INSTANCE_ID])
            return
        LOG.info('Waiting for Synth Forge %s engine', COMPUTE_MODE)
        time.sleep(10)
    idle_since = time.monotonic()
    while True:
        response = sqs.receive_message(QueueUrl=QUEUE_URL, MaxNumberOfMessages=1,
                                       WaitTimeSeconds=20, VisibilityTimeout=JOB_SECONDS + 120)
        messages = response.get('Messages', [])
        if not messages:
            if time.monotonic() - idle_since >= IDLE_SECONDS and queue_depth() == 0:
                LOG.info('Queue idle; stopping EC2 worker')
                ec2.stop_instances(InstanceIds=[INSTANCE_ID])
                return
            continue
        idle_since = time.monotonic()
        message = messages[0]
        try:
            job_id = json.loads(message['Body'])['jobId']
            item = table.get_item(Key={'id': job_id}, ConsistentRead=True).get('Item')
            if item and item['status'] == 'QUEUED' and claim(job_id):
                try:
                    process(item)
                except Exception as error:
                    LOG.exception('Job %s failed', job_id)
                    update(job_id, 'FAILED', failure=str(error)[:300], finishedAt=int(time.time()))
            elif item and item['status'] == 'RUNNING':
                # A lease lasts longer than the job limit. A RUNNING message
                # received again after a worker restart cannot safely be rerun.
                update(job_id, 'FAILED', failure='Cloud worker stopped during processing', finishedAt=int(time.time()))
            sqs.delete_message(QueueUrl=QUEUE_URL, ReceiptHandle=message['ReceiptHandle'])
        except Exception:
            LOG.exception('Could not handle queue message')


if __name__ == '__main__':
    main()
