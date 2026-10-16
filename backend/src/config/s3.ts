import { S3Client } from '@aws-sdk/client-s3';
import { getAwsRegion } from './env.js';

/** Presigned upload and download URLs are short-lived: five minutes. */
export const PRESIGNED_URL_EXPIRES_IN_SECONDS = 300;

let client: S3Client | null = null;

/**
 * Lazily builds a single S3 client. Credentials are resolved by the standard
 * AWS provider chain (environment variables, shared config, or the instance /
 * task role), so nothing is hardcoded here.
 */
export function getS3Client(): S3Client {
  if (!client) {
    client = new S3Client({ region: getAwsRegion() });
  }

  return client;
}
