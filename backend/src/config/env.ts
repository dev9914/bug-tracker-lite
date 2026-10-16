export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error('JWT_SECRET is not set. Add it to backend/.env before starting the server.');
  }

  return secret;
}

export function getJwtExpiresIn(): string {
  return process.env.JWT_EXPIRES_IN ?? '7d';
}

export function getAwsRegion(): string {
  const region = process.env.AWS_REGION;

  if (!region) {
    throw new Error('AWS_REGION is not set. Add it to backend/.env before starting the server.');
  }

  return region;
}

export function getS3BucketName(): string {
  const bucket = process.env.S3_BUCKET_NAME;

  if (!bucket) {
    throw new Error('S3_BUCKET_NAME is not set. Add it to backend/.env before starting the server.');
  }

  return bucket;
}
