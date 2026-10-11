import { randomUUID } from 'node:crypto';
import { HeadObjectCommand } from '@aws-sdk/client-s3';
import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { NextResponse } from 'next/server';
import { getSession } from '../../../lib/auth';
import { cloudConfig, db, jobsEnabled, s3, sqs } from '../../../lib/cloud';

export const runtime = 'nodejs';

export async function POST(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  if (!jobsEnabled(session.userId)) return NextResponse.json({ error: 'Cloud jobs are not available yet' }, { status: 503 });
  const raw = await request.text();
  if (raw.length > 10000) return NextResponse.json({ error: 'Request is too large' }, { status: 413 });
  let body;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const { kind, inputKey } = body;
  if (process.env.CLOUD_COMPUTE_MODE === 'cpu-text' && kind === 'image') {
    return NextResponse.json({ error: 'This CPU demo supports text jobs only' }, { status: 422 });
  }
  if (!['image', 'text'].includes(kind) || typeof inputKey !== 'string' ||
      !new RegExp(`^input/${session.userId}/[0-9a-f-]{36}\\.(png|jpg|jpeg|webp|txt|md|text)$`).test(inputKey) ||
      (kind === 'image' && !/\.(png|jpg|jpeg|webp)$/.test(inputKey)) ||
      (kind === 'text' && !/\.(txt|md|text)$/.test(inputKey))) {
    return NextResponse.json({ error: 'Invalid job' }, { status: 400 });
  }
  let options;
  if (kind === 'image') {
    const adaptiveLevel = body.adaptiveLevel ?? 6;
    const denoiseMin = body.denoiseMin ?? 0.08;
    const denoiseMax = body.denoiseMax ?? 0.15;
    if (!Number.isInteger(adaptiveLevel) || adaptiveLevel < 1 || adaptiveLevel > 10 ||
        typeof denoiseMin !== 'number' || typeof denoiseMax !== 'number' ||
        denoiseMin < 0 || denoiseMin > denoiseMax || denoiseMax > 1) {
      return NextResponse.json({ error: 'Invalid image settings' }, { status: 400 });
    }
    options = { adaptiveLevel, denoiseMin, denoiseMax };
  } else {
    const editLimit = body.editLimit ?? 0.12;
    const model = body.model ?? process.env.CLOUD_DEFAULT_TEXT_MODEL;
    if (typeof editLimit !== 'number' || editLimit < 0 || editLimit > 1 ||
        typeof model !== 'string' || !/^[A-Za-z0-9_.:/-]{1,200}$/.test(model)) {
      return NextResponse.json({ error: 'Invalid text settings or model' }, { status: 400 });
    }
    options = { editLimit, model };
  }
  const { bucket, queueUrl, jobsTable } = cloudConfig();
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: inputKey }));
  } catch {
    return NextResponse.json({ error: 'Input file not found' }, { status: 404 });
  }
  const id = randomUUID();
  const item = { id, userId: session.userId, kind, options, inputKey,
    status: 'QUEUED', createdAt: new Date().toISOString() };
  if (process.env.CLOUD_COMPUTE_MODE === 'cpu-text') {
    try {
      await db.send(new UpdateCommand({ TableName: jobsTable,
        Key: { id: `cpu-demo-limit/${session.userId}` },
        UpdateExpression: 'ADD #used :one',
        ConditionExpression: 'attribute_not_exists(#used) OR #used < :limit',
        ExpressionAttributeNames: { '#used': 'used' },
        ExpressionAttributeValues: { ':one': 1, ':limit': 1 },
      }));
    } catch (error) {
      if (error.name === 'ConditionalCheckFailedException') {
        return NextResponse.json({ error: 'The one-job CPU demo limit has been reached' }, { status: 429 });
      }
      throw error;
    }
  }
  await db.send(new PutCommand({ TableName: jobsTable, Item: item, ConditionExpression: 'attribute_not_exists(id)' }));
  try {
    await sqs.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify({ jobId: id }) }));
  } catch (error) {
    await db.send(new UpdateCommand({ TableName: jobsTable, Key: { id },
      UpdateExpression: 'SET #status = :failed',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':failed': 'FAILED' } }));
    throw error;
  }
  return NextResponse.json({ id, status: item.status }, { status: 202 });
}
