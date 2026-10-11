import { randomUUID } from 'node:crypto';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { NextResponse } from 'next/server';
import { getSession } from '../../../lib/auth';
import { cloudConfig, jobsEnabled, s3 } from '../../../lib/cloud';

export const runtime = 'nodejs';
const MAX_BYTES = 20 * 1024 * 1024;
const TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'text/plain', 'text/markdown']);

export async function POST(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  if (!jobsEnabled(session.userId)) return NextResponse.json({ error: 'Cloud jobs are not available yet' }, { status: 503 });
  const length = Number(request.headers.get('content-length'));
  if (!Number.isFinite(length) || length <= 0 || length > MAX_BYTES + 100000) {
    return NextResponse.json({ error: 'File is too large' }, { status: 413 });
  }
  const form = await request.formData();
  const file = form.get('file');
  const extension = file instanceof File ? file.name.toLowerCase().match(/\.(png|jpg|jpeg|webp|txt|md|text)$/)?.[1] : null;
  const isText = ['txt', 'md', 'text'].includes(extension);
  if (process.env.CLOUD_COMPUTE_MODE === 'cpu-text' && extension && !isText) {
    return NextResponse.json({ error: 'This CPU demo supports text files only' }, { status: 422 });
  }
  if (!(file instanceof File) || file.size > (isText ? 2 * 1024 * 1024 : MAX_BYTES) ||
      !TYPES.has(file.type) || !extension) {
    return NextResponse.json({ error: 'Use a PNG, JPEG, WebP (20 MB) or .txt/.md/.text file (2 MB)' }, { status: 400 });
  }
  if (process.env.CLOUD_COMPUTE_MODE === 'cpu-text' && file.size > 8192) {
    return NextResponse.json({ error: 'Use a short text file of 8 KB or less for this CPU demo' }, { status: 413 });
  }
  const { bucket } = cloudConfig();
  const key = `input/${session.userId}/${randomUUID()}.${extension}`;
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: Buffer.from(await file.arrayBuffer()),
    ContentType: file.type,
    ServerSideEncryption: 'AES256',
  }));
  return NextResponse.json({ inputKey: key }, { status: 201 });
}
