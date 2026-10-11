import { randomUUID } from 'node:crypto';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { NextResponse } from 'next/server';
import { getSession } from '../../../lib/auth';
import { cloudConfig, jobsEnabled, s3 } from '../../../lib/cloud';

export const runtime = 'nodejs';
const MAX_BYTES = 20 * 1024 * 1024;
const TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'text/plain']);

export async function POST(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  if (!jobsEnabled()) return NextResponse.json({ error: 'Cloud jobs are not available yet' }, { status: 503 });
  const length = Number(request.headers.get('content-length'));
  if (!Number.isFinite(length) || length <= 0 || length > MAX_BYTES + 100000) {
    return NextResponse.json({ error: 'File is too large' }, { status: 413 });
  }
  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File) || file.size > MAX_BYTES || !TYPES.has(file.type)) {
    return NextResponse.json({ error: 'Use a PNG, JPEG, WebP, PDF, or text file up to 20 MB' }, { status: 400 });
  }
  const { bucket } = cloudConfig();
  const key = `input/${session.userId}/${randomUUID()}`;
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: Buffer.from(await file.arrayBuffer()),
    ContentType: file.type,
    ServerSideEncryption: 'AES256',
  }));
  return NextResponse.json({ inputKey: key }, { status: 201 });
}
