import { GetObjectCommand } from '@aws-sdk/client-s3';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { NextResponse } from 'next/server';
import { getSession } from '../../../../lib/auth';
import { cloudConfig, db, s3 } from '../../../../lib/cloud';

export const runtime = 'nodejs';

export async function GET(_request, { params }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { bucket, jobsTable } = cloudConfig();
  const result = await db.send(new GetCommand({ TableName: jobsTable, Key: { id }, ConsistentRead: true }));
  const job = result.Item;
  if (!job || job.userId !== session.userId) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const response = { id, kind: job.kind, status: job.status, createdAt: job.createdAt };
  if (job.status === 'SUCCEEDED' && job.outputKey?.startsWith(`output/${session.userId}/`)) {
    response.downloadUrl = await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: job.outputKey }), { expiresIn: 300 });
  }
  return NextResponse.json(response, { headers: { 'Cache-Control': 'no-store' } });
}
