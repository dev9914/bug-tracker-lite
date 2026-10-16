import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/app.js';
import { BugModel } from '../src/models/bug.model.js';
import { createPresignedGetUrl, deleteObject, headObject, readObjectPrefix } from '../src/services/s3.service.js';

vi.mock('express-rate-limit', () => ({
  default: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../src/models/bug.model.js', () => ({
  BugModel: {
    findOne: vi.fn(),
  },
  BUG_SEVERITIES: ['low', 'med', 'high'],
  BUG_STATUSES: ['open', 'in-progress', 'closed'],
}));

// AWS is mocked: no credentials, bucket, or network access are required here.
vi.mock('../src/services/s3.service.js', () => ({
  createPresignedPutUrl: vi.fn(),
  createPresignedGetUrl: vi.fn(),
  headObject: vi.fn(),
  readObjectPrefix: vi.fn(),
  deleteObject: vi.fn(),
}));

const mockedBug = BugModel as unknown as { findOne: ReturnType<typeof vi.fn> };
const mockedHeadObject = headObject as unknown as ReturnType<typeof vi.fn>;
const mockedReadPrefix = readObjectPrefix as unknown as ReturnType<typeof vi.fn>;
const mockedDeleteObject = deleteObject as unknown as ReturnType<typeof vi.fn>;
const mockedPresignGet = createPresignedGetUrl as unknown as ReturnType<typeof vi.fn>;

const ORIGINAL_JWT_SECRET = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'test-secret';

const USER_ID = '64b7f1c2a1b2c3d4e5f60718';
const OTHER_USER_ID = '64b7f1c2a1b2c3d4e5f60719';
const BUG_ID = '64b7f1c2a1b2c3d4e5f60720';
const IMAGE_KEY = `uploads/${USER_ID}/11111111-2222-3333-4444-555555555555.png`;
const FIVE_MB = 5 * 1024 * 1024;

// Minimal byte sequences with the right magic numbers for file-type to detect.
const PNG_BYTES = Buffer.concat([
  Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00,
    0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89,
  ]),
  Buffer.alloc(64),
]);
const JPEG_BYTES = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]),
  Buffer.alloc(64),
]);
const NOT_IMAGE_BYTES = Buffer.alloc(128);

const authHeader = (userId: string = USER_ID) => ({
  Authorization: `Bearer ${jwt.sign({ sub: userId }, 'test-secret', { expiresIn: '1h' })}`,
});

function makeBug(overrides: Record<string, unknown> = {}) {
  return {
    id: BUG_ID,
    userId: USER_ID,
    title: 'Login button broken',
    description: 'Clicking login does nothing',
    severity: 'high',
    status: 'open',
    imageKey: undefined,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    save: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterAll(() => {
  process.env.JWT_SECRET = ORIGINAL_JWT_SECRET;
});

describe('authentication', () => {
  it.each([
    ['post', `/api/bugs/${BUG_ID}/image`],
    ['get', `/api/bugs/${BUG_ID}/image-url`],
  ] as const)('rejects unauthenticated %s %s', async (method, path) => {
    const response = await request(app)[method](path);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });
});

describe('POST /api/bugs/:id/image', () => {
  it('attaches a verified uploaded image to an owned bug', async () => {
    const bug = makeBug();
    mockedBug.findOne.mockResolvedValue(bug);
    mockedHeadObject.mockResolvedValue({ contentLength: 1024, contentType: 'image/png' });
    mockedReadPrefix.mockResolvedValue(PNG_BYTES);

    const response = await request(app)
      .post(`/api/bugs/${BUG_ID}/image`)
      .set(authHeader())
      .send({ imageKey: IMAGE_KEY });

    expect(response.status).toBe(200);
    expect(response.body.bug.imageKey).toBe(IMAGE_KEY);
    expect(mockedHeadObject).toHaveBeenCalledWith(IMAGE_KEY);
    expect(mockedReadPrefix).toHaveBeenCalledWith(IMAGE_KEY, expect.any(Number));
    expect(bug.save).toHaveBeenCalledTimes(1);
    expect(mockedBug.findOne).toHaveBeenCalledWith({ _id: BUG_ID, userId: USER_ID });
  });

  it("rejects an image key belonging to another user", async () => {
    const foreignKey = `uploads/${OTHER_USER_ID}/11111111-2222-3333-4444-555555555555.png`;

    const response = await request(app)
      .post(`/api/bugs/${BUG_ID}/image`)
      .set(authHeader())
      .send({ imageKey: foreignKey });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_IMAGE_KEY');
    expect(mockedBug.findOne).not.toHaveBeenCalled();
    expect(mockedHeadObject).not.toHaveBeenCalled();
  });

  it.each(['../../etc/passwd', 'uploads/anything.png', 'https://evil.example.com/a.png'])(
    'rejects the arbitrary key %s',
    async (imageKey) => {
      const response = await request(app).post(`/api/bugs/${BUG_ID}/image`).set(authHeader()).send({ imageKey });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVALID_IMAGE_KEY');
      expect(mockedHeadObject).not.toHaveBeenCalled();
    },
  );

  it('rejects an image that was never uploaded', async () => {
    const bug = makeBug();
    mockedBug.findOne.mockResolvedValue(bug);
    mockedHeadObject.mockResolvedValue(null);

    const response = await request(app)
      .post(`/api/bugs/${BUG_ID}/image`)
      .set(authHeader())
      .send({ imageKey: IMAGE_KEY });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('IMAGE_NOT_UPLOADED');
    expect(bug.save).not.toHaveBeenCalled();
  });

  it('rejects an object whose real size exceeds 5 MB and removes the rejected upload', async () => {
    const bug = makeBug();
    mockedBug.findOne.mockResolvedValue(bug);
    mockedHeadObject.mockResolvedValue({ contentLength: FIVE_MB + 1, contentType: 'image/png' });
    mockedDeleteObject.mockResolvedValue(undefined);

    const response = await request(app)
      .post(`/api/bugs/${BUG_ID}/image`)
      .set(authHeader())
      .send({ imageKey: IMAGE_KEY });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('IMAGE_TOO_LARGE');
    expect(bug.save).not.toHaveBeenCalled();
    // The oversized object is never read and the user's own upload is cleaned up.
    expect(mockedReadPrefix).not.toHaveBeenCalled();
    expect(mockedDeleteObject).toHaveBeenCalledWith(IMAGE_KEY);
  });

  it('rejects an object whose stored content type is not an image we allow and removes it', async () => {
    const bug = makeBug();
    mockedBug.findOne.mockResolvedValue(bug);
    mockedHeadObject.mockResolvedValue({ contentLength: 1024, contentType: 'application/pdf' });
    mockedDeleteObject.mockResolvedValue(undefined);

    const response = await request(app)
      .post(`/api/bugs/${BUG_ID}/image`)
      .set(authHeader())
      .send({ imageKey: IMAGE_KEY });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('UNSUPPORTED_IMAGE_TYPE');
    expect(bug.save).not.toHaveBeenCalled();
    expect(mockedDeleteObject).toHaveBeenCalledWith(IMAGE_KEY);
  });

  it('rejects bytes that are not a real image even when the declared type is an image', async () => {
    const bug = makeBug();
    mockedBug.findOne.mockResolvedValue(bug);
    mockedHeadObject.mockResolvedValue({ contentLength: 1024, contentType: 'image/png' });
    mockedReadPrefix.mockResolvedValue(NOT_IMAGE_BYTES);
    mockedDeleteObject.mockResolvedValue(undefined);

    const response = await request(app)
      .post(`/api/bugs/${BUG_ID}/image`)
      .set(authHeader())
      .send({ imageKey: IMAGE_KEY });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_IMAGE_CONTENT');
    expect(bug.save).not.toHaveBeenCalled();
    expect(mockedDeleteObject).toHaveBeenCalledWith(IMAGE_KEY);
  });

  it('rejects a file whose real type does not match its declared type', async () => {
    const bug = makeBug();
    mockedBug.findOne.mockResolvedValue(bug);
    // Declared as PNG, but the magic bytes are a JPEG.
    mockedHeadObject.mockResolvedValue({ contentLength: 1024, contentType: 'image/png' });
    mockedReadPrefix.mockResolvedValue(JPEG_BYTES);
    mockedDeleteObject.mockResolvedValue(undefined);

    const response = await request(app)
      .post(`/api/bugs/${BUG_ID}/image`)
      .set(authHeader())
      .send({ imageKey: IMAGE_KEY });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('IMAGE_CONTENT_TYPE_MISMATCH');
    expect(bug.save).not.toHaveBeenCalled();
    expect(mockedDeleteObject).toHaveBeenCalledWith(IMAGE_KEY);
  });

  it('still rejects the image when cleaning up the rejected object fails', async () => {
    const bug = makeBug();
    mockedBug.findOne.mockResolvedValue(bug);
    mockedHeadObject.mockResolvedValue({ contentLength: FIVE_MB + 1, contentType: 'image/png' });
    mockedDeleteObject.mockRejectedValue(new Error('AccessDenied'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const response = await request(app)
        .post(`/api/bugs/${BUG_ID}/image`)
        .set(authHeader())
        .send({ imageKey: IMAGE_KEY });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('IMAGE_TOO_LARGE');
      expect(bug.save).not.toHaveBeenCalled();
      // The cleanup failure is logged and swallowed, not surfaced as a 5xx.
      expect(consoleSpy).toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('returns 502 when reading the stored object for content sniffing fails', async () => {
    const bug = makeBug();
    mockedBug.findOne.mockResolvedValue(bug);
    mockedHeadObject.mockResolvedValue({ contentLength: 1024, contentType: 'image/png' });
    mockedReadPrefix.mockRejectedValue(new Error('AccessDenied'));

    const response = await request(app)
      .post(`/api/bugs/${BUG_ID}/image`)
      .set(authHeader())
      .send({ imageKey: IMAGE_KEY });

    expect(response.status).toBe(502);
    expect(response.body.error.code).toBe('S3_ERROR');
    expect(bug.save).not.toHaveBeenCalled();
  });

  it("returns 404 for a bug owned by another user", async () => {
    // The caller may use their own upload key, but the bug belongs to someone else.
    const ownKey = `uploads/${OTHER_USER_ID}/11111111-2222-3333-4444-555555555555.png`;
    mockedBug.findOne.mockResolvedValue(null);

    const response = await request(app)
      .post(`/api/bugs/${BUG_ID}/image`)
      .set(authHeader(OTHER_USER_ID))
      .send({ imageKey: ownKey });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
    expect(mockedHeadObject).not.toHaveBeenCalled();
  });

  it('returns 400 for a malformed bug id', async () => {
    const response = await request(app)
      .post('/api/bugs/not-an-id/image')
      .set(authHeader())
      .send({ imageKey: IMAGE_KEY });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_ID');
  });

  it('returns 502 when S3 verification fails', async () => {
    mockedBug.findOne.mockResolvedValue(makeBug());
    mockedHeadObject.mockRejectedValue(new Error('AccessDenied'));

    const response = await request(app)
      .post(`/api/bugs/${BUG_ID}/image`)
      .set(authHeader())
      .send({ imageKey: IMAGE_KEY });

    expect(response.status).toBe(502);
    expect(response.body.error.code).toBe('S3_ERROR');
  });
});

describe('GET /api/bugs/:id/image-url', () => {
  it('returns a presigned GET url for an owned bug with an image', async () => {
    mockedBug.findOne.mockResolvedValue(makeBug({ imageKey: IMAGE_KEY }));
    mockedPresignGet.mockResolvedValue('https://bucket.s3.amazonaws.com/get-signed');

    const response = await request(app).get(`/api/bugs/${BUG_ID}/image-url`).set(authHeader());

    expect(response.status).toBe(200);
    expect(response.body.image.url).toBe('https://bucket.s3.amazonaws.com/get-signed');
    expect(response.body.image.key).toBe(IMAGE_KEY);
    expect(response.body.image.expiresIn).toBe(300);
    expect(mockedPresignGet).toHaveBeenCalledWith(IMAGE_KEY);
    expect(mockedBug.findOne).toHaveBeenCalledWith({ _id: BUG_ID, userId: USER_ID });
  });

  it('returns 404 when the bug has no image', async () => {
    mockedBug.findOne.mockResolvedValue(makeBug({ imageKey: undefined }));

    const response = await request(app).get(`/api/bugs/${BUG_ID}/image-url`).set(authHeader());

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('IMAGE_NOT_FOUND');
    expect(mockedPresignGet).not.toHaveBeenCalled();
  });

  it("does not sign a url for a stored key that belongs to another user", async () => {
    // Defence in depth: a foreign key must never be presigned for the caller.
    const foreignKey = `uploads/${OTHER_USER_ID}/11111111-2222-3333-4444-555555555555.png`;
    mockedBug.findOne.mockResolvedValue(makeBug({ imageKey: foreignKey }));

    const response = await request(app).get(`/api/bugs/${BUG_ID}/image-url`).set(authHeader());

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('IMAGE_NOT_FOUND');
    expect(mockedPresignGet).not.toHaveBeenCalled();
  });

  it("returns 404 for another user's bug", async () => {
    mockedBug.findOne.mockResolvedValue(null);

    const response = await request(app).get(`/api/bugs/${BUG_ID}/image-url`).set(authHeader(OTHER_USER_ID));

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
    expect(mockedPresignGet).not.toHaveBeenCalled();
  });

  it('returns 400 for a malformed bug id', async () => {
    const response = await request(app).get('/api/bugs/not-an-id/image-url').set(authHeader());

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_ID');
  });

  it('returns 502 when S3 cannot sign a url', async () => {
    mockedBug.findOne.mockResolvedValue(makeBug({ imageKey: IMAGE_KEY }));
    mockedPresignGet.mockRejectedValue(new Error('AccessDenied'));

    const response = await request(app).get(`/api/bugs/${BUG_ID}/image-url`).set(authHeader());

    expect(response.status).toBe(502);
    expect(response.body.error.code).toBe('S3_ERROR');
  });
});
