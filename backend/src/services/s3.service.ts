import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PRESIGNED_URL_EXPIRES_IN_SECONDS, getS3Client } from '../config/s3.js';
import { getS3BucketName } from '../config/env.js';

export interface S3ObjectSummary {
  contentLength: number;
  contentType: string | undefined;
}

/**
 * Thin wrapper around the S3 operations this API needs. Controllers depend on
 * this module (not on the SDK directly), which also keeps the AWS boundary easy
 * to mock in tests.
 */

export async function createPresignedPutUrl(key: string, contentType: string): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: getS3BucketName(),
    Key: key,
    ContentType: contentType,
  });

  return getSignedUrl(getS3Client(), command, { expiresIn: PRESIGNED_URL_EXPIRES_IN_SECONDS });
}

export async function createPresignedGetUrl(key: string): Promise<string> {
  const command = new GetObjectCommand({ Bucket: getS3BucketName(), Key: key });

  return getSignedUrl(getS3Client(), command, { expiresIn: PRESIGNED_URL_EXPIRES_IN_SECONDS });
}

/** Returns null when the object does not exist, and throws on other S3 failures. */
export async function headObject(key: string): Promise<S3ObjectSummary | null> {
  try {
    const result = await getS3Client().send(new HeadObjectCommand({ Bucket: getS3BucketName(), Key: key }));

    return { contentLength: result.ContentLength ?? 0, contentType: result.ContentType };
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }

    throw error;
  }
}

/**
 * Downloads only the first `byteCount` bytes of an object so the caller can
 * sniff its magic numbers without pulling the whole (up to 5 MB) file.
 */
export async function readObjectPrefix(key: string, byteCount: number): Promise<Buffer> {
  const result = await getS3Client().send(
    new GetObjectCommand({ Bucket: getS3BucketName(), Key: key, Range: `bytes=0-${byteCount - 1}` }),
  );

  const bytes = await result.Body?.transformToByteArray();

  return Buffer.from(bytes ?? new Uint8Array());
}

export async function deleteObject(key: string): Promise<void> {
  await getS3Client().send(new DeleteObjectCommand({ Bucket: getS3BucketName(), Key: key }));
}

function isNotFoundError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const { name, $metadata } = error as { name?: string; $metadata?: { httpStatusCode?: number } };

  return name === 'NotFound' || name === 'NoSuchKey' || $metadata?.httpStatusCode === 404;
}
