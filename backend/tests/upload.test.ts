import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/app.js';
import { createPresignedPutUrl } from '../src/services/s3.service.js';

vi.mock('express-rate-limit', () => ({
  default: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// AWS is mocked: no credentials, bucket, or network access are required here.
vi.mock('../src/services/s3.service.js', () => ({
  createPresignedPutUrl: vi.fn(),
  createPresignedGetUrl: vi.fn(),
  headObject: vi.fn(),
  readObjectPrefix: vi.fn(),
  deleteObject: vi.fn(),
}));

const mockedPresignPut = createPresignedPutUrl as unknown as ReturnType<typeof vi.fn>;

const ORIGINAL_JWT_SECRET = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'test-secret';

const USER_ID = '64b7f1c2a1b2c3d4e5f60718';
const FIVE_MB = 5 * 1024 * 1024;

const authHeader = () => ({
  Authorization: `Bearer ${jwt.sign({ sub: USER_ID }, 'test-secret', { expiresIn: '1h' })}`,
});

const api = (method: 'get' | 'post', path: string) => request(app)[method](path);

beforeEach(() => {
  vi.clearAllMocks();
});

afterAll(() => {
  process.env.JWT_SECRET = ORIGINAL_JWT_SECRET;
});

describe('authentication', () => {
  it('rejects unauthenticated presign requests', async () => {
    const response = await api('post', '/api/uploads/presign').send({ contentType: 'image/png' });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });
});

describe('POST /api/uploads/presign', () => {
  it.each([
    ['image/jpeg', 'jpg'],
    ['image/png', 'png'],
    ['image/webp', 'webp'],
  ])('returns a user-scoped presigned PUT url for %s', async (contentType, extension) => {
    mockedPresignPut.mockResolvedValue('https://bucket.s3.amazonaws.com/signed');

    const response = await api('post', '/api/uploads/presign').set(authHeader()).send({ contentType });

    expect(response.status).toBe(200);

    const key = response.body.upload.key as string;
    expect(key).toMatch(new RegExp(`^uploads/${USER_ID}/[0-9a-f-]{36}\\.${extension}$`));
    expect(response.body.upload.url).toBe('https://bucket.s3.amazonaws.com/signed');
    expect(response.body.upload.contentType).toBe(contentType);
    expect(response.body.upload.maxSizeBytes).toBe(FIVE_MB);
    expect(response.body.upload.expiresIn).toBe(300);
    expect(mockedPresignPut).toHaveBeenCalledWith(key, contentType);
  });

  it('generates a different key on every call', async () => {
    mockedPresignPut.mockResolvedValue('https://bucket.s3.amazonaws.com/signed');

    const first = await api('post', '/api/uploads/presign').set(authHeader()).send({ contentType: 'image/png' });
    const second = await api('post', '/api/uploads/presign').set(authHeader()).send({ contentType: 'image/png' });

    expect(first.body.upload.key).not.toBe(second.body.upload.key);
  });

  it('accepts a declared size within the 5 MB limit', async () => {
    mockedPresignPut.mockResolvedValue('https://bucket.s3.amazonaws.com/signed');

    const response = await api('post', '/api/uploads/presign')
      .set(authHeader())
      .send({ contentType: 'image/png', size: FIVE_MB });

    expect(response.status).toBe(200);
  });

  it.each(['image/gif', 'image/svg+xml', 'application/pdf', 'text/plain'])(
    'rejects the unsupported file type %s',
    async (contentType) => {
      const response = await api('post', '/api/uploads/presign').set(authHeader()).send({ contentType });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(mockedPresignPut).not.toHaveBeenCalled();
    },
  );

  it('rejects a declared size larger than 5 MB', async () => {
    const response = await api('post', '/api/uploads/presign')
      .set(authHeader())
      .send({ contentType: 'image/png', size: FIVE_MB + 1 });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(mockedPresignPut).not.toHaveBeenCalled();
  });

  it('ignores a client-supplied key and never accepts arbitrary keys', async () => {
    mockedPresignPut.mockResolvedValue('https://bucket.s3.amazonaws.com/signed');

    const response = await api('post', '/api/uploads/presign')
      .set(authHeader())
      .send({ contentType: 'image/png', key: `uploads/${USER_ID}/11111111-2222-3333-4444-555555555555.png` });

    // The strict schema rejects the unexpected key field outright.
    expect(response.status).toBe(400);
    expect(mockedPresignPut).not.toHaveBeenCalled();
  });

  it('returns 502 when S3 cannot sign a url', async () => {
    mockedPresignPut.mockRejectedValue(new Error('CredentialsProviderError'));

    const response = await api('post', '/api/uploads/presign').set(authHeader()).send({ contentType: 'image/png' });

    expect(response.status).toBe(502);
    expect(response.body.error.code).toBe('S3_ERROR');
  });
});
