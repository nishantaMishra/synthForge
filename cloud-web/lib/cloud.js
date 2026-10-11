import { S3Client } from '@aws-sdk/client-s3';
import { SQSClient } from '@aws-sdk/client-sqs';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

export const s3 = new S3Client({});
export const sqs = new SQSClient({});
export const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export function cloudConfig() {
  const bucket = process.env.CLOUD_BUCKET;
  const queueUrl = process.env.CLOUD_QUEUE_URL;
  const jobsTable = process.env.CLOUD_JOBS_TABLE;
  if (!bucket || !queueUrl || !jobsTable) {
    throw new Error('CLOUD_BUCKET, CLOUD_QUEUE_URL, and CLOUD_JOBS_TABLE are required');
  }
  return { bucket, queueUrl, jobsTable };
}

export function cpuDemoAllowed(userId) {
  // Only the owner account can run the temporary text demo. This is not a paid
  // entitlement and must not be used to grant general cloud access.
  const expires = process.env.CLOUD_DEMO_EXPIRES_AT;
  const open = !expires || Date.now() < Date.parse(expires);
  return open && process.env.CLOUD_COMPUTE_MODE === 'cpu-text' &&
    Boolean(process.env.CLOUD_CPU_DEMO_USER_ID) &&
    userId === process.env.CLOUD_CPU_DEMO_USER_ID;
}

export function jobsEnabled(userId) {
  // The monetization integration must add a real per-user entitlement check
  // before any paid or public cloud work can run.
  return cpuDemoAllowed(userId);
}
