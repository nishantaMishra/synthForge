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

export function jobsEnabled() {
  // The monetization integration must replace this gate with a real per-user
  // entitlement check before any paid work can run.
  return false;
}
