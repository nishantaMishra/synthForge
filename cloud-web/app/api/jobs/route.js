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
  if (!jobsEnabled()) return NextResponse.json({ error: 'Cloud jobs are not available yet' }, { status: 503 });
  const raw = await request.text();
  if (raw.length > 10000) return NextResponse.json({ error: 'Request is too large' }, { status: 413 });
  let body;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const { kind, prompt, inputKey } = body;
  if (!['image', 'text'].includes(kind) || typeof prompt !== 'string' || prompt.length > 4000 ||
      (inputKey !== undefined && (typeof inputKey !== 'string' || !inputKey.startsWith(`input/${session.userId}/`)))) {
    return NextResponse.json({ error: 'Invalid job' }, { status: 400 });
  }
  const { bucket, queueUrl, jobsTable } = cloudConfig();
  if (inputKey) {
    try {
      await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: inputKey }));
    } catch {
      return NextResponse.json({ error: 'Input file not found' }, { status: 404 });
    }
  }
  const id = randomUUID();
  const item = { id, userId: session.userId, kind, prompt, inputKey: inputKey || null,
    status: 'QUEUED', createdAt: new Date().toISOString() };
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
