import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/app.js';
import { BugModel } from '../src/models/bug.model.js';
import { deleteObject } from '../src/services/s3.service.js';

// The global limiter would not trip here, but stubbing it keeps the suite deterministic.
vi.mock('express-rate-limit', () => ({
  default: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// Mongoose is mocked so these tests need no MongoDB instance.
// The enum constants must be included because the Zod schemas import them.
vi.mock('../src/models/bug.model.js', () => ({
  BugModel: {
    create: vi.fn(),
    find: vi.fn(),
    findOne: vi.fn(),
    findOneAndUpdate: vi.fn(),
    deleteOne: vi.fn(),
  },
  BUG_SEVERITIES: ['low', 'med', 'high'],
  BUG_STATUSES: ['open', 'in-progress', 'closed'],
}));

// AWS calls are mocked: no credentials or network access are needed.
vi.mock('../src/services/s3.service.js', () => ({
  createPresignedPutUrl: vi.fn(),
  createPresignedGetUrl: vi.fn(),
  headObject: vi.fn(),
  readObjectPrefix: vi.fn(),
  deleteObject: vi.fn(),
}));

const mockedBug = BugModel as unknown as {
  create: ReturnType<typeof vi.fn>;
  find: ReturnType<typeof vi.fn>;
  findOne: ReturnType<typeof vi.fn>;
  findOneAndUpdate: ReturnType<typeof vi.fn>;
  deleteOne: ReturnType<typeof vi.fn>;
};

const mockedDeleteObject = deleteObject as unknown as ReturnType<typeof vi.fn>;

const ORIGINAL_JWT_SECRET = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'test-secret';

const USER_ID = '64b7f1c2a1b2c3d4e5f60718';
const OTHER_USER_ID = '64b7f1c2a1b2c3d4e5f60719';
const BUG_ID = '64b7f1c2a1b2c3d4e5f60720';
const IMAGE_KEY = `uploads/${USER_ID}/11111111-2222-3333-4444-555555555555.png`;

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
    ...overrides,
  };
}

const validPayload = {
  title: 'Login button broken',
  description: 'Clicking login does nothing',
  severity: 'high',
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterAll(() => {
  process.env.JWT_SECRET = ORIGINAL_JWT_SECRET;
});

describe('authentication requirement', () => {
  it.each([
    ['post', '/api/bugs'],
    ['get', '/api/bugs'],
    ['get', `/api/bugs/${BUG_ID}`],
    ['put', `/api/bugs/${BUG_ID}`],
    ['delete', `/api/bugs/${BUG_ID}`],
  ] as const)('rejects unauthenticated %s %s', async (method, path) => {
    const response = await request(app)[method](path);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });
});

describe('POST /api/bugs', () => {
  it('creates a bug owned by the authenticated user', async () => {
    mockedBug.create.mockResolvedValue(makeBug());

    const response = await request(app).post('/api/bugs').set(authHeader()).send(validPayload);

    expect(response.status).toBe(201);
    expect(response.body.bug.id).toBe(BUG_ID);
    expect(response.body.bug.userId).toBe(USER_ID);
    expect(mockedBug.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID, title: validPayload.title, severity: 'high' }),
    );
  });

  it('rejects an invalid severity', async () => {
    const response = await request(app)
      .post('/api/bugs')
      .set(authHeader())
      .send({ ...validPayload, severity: 'critical' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(mockedBug.create).not.toHaveBeenCalled();
  });

  it('rejects an invalid status', async () => {
    const response = await request(app)
      .post('/api/bugs')
      .set(authHeader())
      .send({ ...validPayload, status: 'done' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it("rejects a client-supplied userId instead of trusting it", async () => {
    const response = await request(app)
      .post('/api/bugs')
      .set(authHeader())
      .send({ ...validPayload, userId: OTHER_USER_ID });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(mockedBug.create).not.toHaveBeenCalled();
  });

  it('rejects a client-supplied imageKey, which may only be set by the attach endpoint', async () => {
    const response = await request(app)
      .post('/api/bugs')
      .set(authHeader())
      .send({ ...validPayload, imageKey: 'https://evil.example.com/screenshot.png' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(mockedBug.create).not.toHaveBeenCalled();
  });
});

describe('GET /api/bugs', () => {
  it("lists only the authenticated user's bugs, newest first", async () => {
    const sort = vi.fn().mockResolvedValue([makeBug()]);
    mockedBug.find.mockReturnValue({ sort });

    const response = await request(app).get('/api/bugs').set(authHeader());

    expect(response.status).toBe(200);
    expect(response.body.bugs).toHaveLength(1);
    expect(response.body.bugs[0].id).toBe(BUG_ID);
    expect(mockedBug.find).toHaveBeenCalledWith({ userId: USER_ID });
    expect(sort).toHaveBeenCalledWith({ createdAt: -1 });
  });

  it('filters by status when a valid status is supplied', async () => {
    const sort = vi.fn().mockResolvedValue([]);
    mockedBug.find.mockReturnValue({ sort });

    const response = await request(app).get('/api/bugs?status=closed').set(authHeader());

    expect(response.status).toBe(200);
    expect(mockedBug.find).toHaveBeenCalledWith({ userId: USER_ID, status: 'closed' });
  });

  it('rejects an invalid status filter', async () => {
    const response = await request(app).get('/api/bugs?status=bogus').set(authHeader());

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(mockedBug.find).not.toHaveBeenCalled();
  });
});

describe('GET /api/bugs/:id', () => {
  it('returns a bug owned by the user', async () => {
    mockedBug.findOne.mockResolvedValue(makeBug());

    const response = await request(app).get(`/api/bugs/${BUG_ID}`).set(authHeader());

    expect(response.status).toBe(200);
    expect(response.body.bug.id).toBe(BUG_ID);
    expect(mockedBug.findOne).toHaveBeenCalledWith({ _id: BUG_ID, userId: USER_ID });
  });

  it("returns 404 for another user's bug without leaking it", async () => {
    mockedBug.findOne.mockResolvedValue(null);

    const response = await request(app).get(`/api/bugs/${BUG_ID}`).set(authHeader(OTHER_USER_ID));

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
    expect(mockedBug.findOne).toHaveBeenCalledWith({ _id: BUG_ID, userId: OTHER_USER_ID });
  });

  it.each(['not-an-id', '123', 'zzzzzzzzzzzzzzzzzzzzzzzz'])('rejects malformed id "%s"', async (id) => {
    const response = await request(app).get(`/api/bugs/${id}`).set(authHeader());

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_ID');
    expect(mockedBug.findOne).not.toHaveBeenCalled();
  });
});

describe('PUT /api/bugs/:id', () => {
  it('updates an owned bug', async () => {
    mockedBug.findOneAndUpdate.mockResolvedValue(makeBug({ status: 'closed', severity: 'low' }));

    const response = await request(app)
      .put(`/api/bugs/${BUG_ID}`)
      .set(authHeader())
      .send({ status: 'closed', severity: 'low' });

    expect(response.status).toBe(200);
    expect(response.body.bug.status).toBe('closed');
    expect(mockedBug.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: BUG_ID, userId: USER_ID },
      { status: 'closed', severity: 'low' },
      { new: true, runValidators: true },
    );
  });

  it("prevents updating another user's bug", async () => {
    mockedBug.findOneAndUpdate.mockResolvedValue(null);

    const response = await request(app)
      .put(`/api/bugs/${BUG_ID}`)
      .set(authHeader(OTHER_USER_ID))
      .send({ status: 'closed' });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
    expect(mockedBug.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: BUG_ID, userId: OTHER_USER_ID },
      { status: 'closed' },
      { new: true, runValidators: true },
    );
  });

  it('rejects an invalid severity on update', async () => {
    const response = await request(app)
      .put(`/api/bugs/${BUG_ID}`)
      .set(authHeader())
      .send({ severity: 'critical' });

    expect(response.status).toBe(400);
    expect(mockedBug.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('rejects unknown fields such as userId', async () => {
    const response = await request(app)
      .put(`/api/bugs/${BUG_ID}`)
      .set(authHeader())
      .send({ userId: OTHER_USER_ID });

    expect(response.status).toBe(400);
    expect(mockedBug.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('rejects a client-supplied imageKey on update', async () => {
    const response = await request(app)
      .put(`/api/bugs/${BUG_ID}`)
      .set(authHeader())
      .send({ imageKey: IMAGE_KEY });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(mockedBug.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('rejects an empty update body', async () => {
    const response = await request(app).put(`/api/bugs/${BUG_ID}`).set(authHeader()).send({});

    expect(response.status).toBe(400);
    expect(mockedBug.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('returns 404 for a nonexistent bug', async () => {
    mockedBug.findOneAndUpdate.mockResolvedValue(null);

    const response = await request(app)
      .put(`/api/bugs/${BUG_ID}`)
      .set(authHeader())
      .send({ title: 'Renamed' });

    expect(response.status).toBe(404);
  });
});

describe('DELETE /api/bugs/:id', () => {
  it('deletes an owned bug that has no image', async () => {
    mockedBug.findOne.mockResolvedValue(makeBug({ imageKey: undefined }));
    mockedBug.deleteOne.mockResolvedValue({ deletedCount: 1 });

    const response = await request(app).delete(`/api/bugs/${BUG_ID}`).set(authHeader());

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, id: BUG_ID });
    expect(mockedBug.deleteOne).toHaveBeenCalledWith({ _id: BUG_ID, userId: USER_ID });
    expect(mockedDeleteObject).not.toHaveBeenCalled();
  });

  it('deletes the attached S3 object as well', async () => {
    mockedBug.findOne.mockResolvedValue(makeBug({ imageKey: IMAGE_KEY }));
    mockedDeleteObject.mockResolvedValue(undefined);
    mockedBug.deleteOne.mockResolvedValue({ deletedCount: 1 });

    const response = await request(app).delete(`/api/bugs/${BUG_ID}`).set(authHeader());

    expect(response.status).toBe(200);
    expect(mockedDeleteObject).toHaveBeenCalledWith(IMAGE_KEY);
    expect(mockedBug.deleteOne).toHaveBeenCalledWith({ _id: BUG_ID, userId: USER_ID });
  });

  it('fails and keeps the bug when S3 cleanup fails', async () => {
    mockedBug.findOne.mockResolvedValue(makeBug({ imageKey: IMAGE_KEY }));
    mockedDeleteObject.mockRejectedValue(new Error('AccessDenied'));

    const response = await request(app).delete(`/api/bugs/${BUG_ID}`).set(authHeader());

    expect(response.status).toBe(502);
    expect(response.body.error.code).toBe('S3_ERROR');
    expect(mockedBug.deleteOne).not.toHaveBeenCalled();
  });

  it("never deletes an S3 object whose key belongs to another user", async () => {
    // Defence in depth: even if a foreign key were somehow stored on the bug,
    // the delete path must not touch that object.
    const foreignKey = `uploads/${OTHER_USER_ID}/11111111-2222-3333-4444-555555555555.png`;
    mockedBug.findOne.mockResolvedValue(makeBug({ imageKey: foreignKey }));
    mockedBug.deleteOne.mockResolvedValue({ deletedCount: 1 });

    const response = await request(app).delete(`/api/bugs/${BUG_ID}`).set(authHeader());

    expect(response.status).toBe(200);
    expect(mockedDeleteObject).not.toHaveBeenCalled();
    expect(mockedBug.deleteOne).toHaveBeenCalledWith({ _id: BUG_ID, userId: USER_ID });
  });

  it("prevents deleting another user's bug", async () => {
    mockedBug.findOne.mockResolvedValue(null);

    const response = await request(app).delete(`/api/bugs/${BUG_ID}`).set(authHeader(OTHER_USER_ID));

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
    expect(mockedDeleteObject).not.toHaveBeenCalled();
  });

  it('returns 404 for a nonexistent bug', async () => {
    mockedBug.findOne.mockResolvedValue(null);

    const response = await request(app).delete(`/api/bugs/${BUG_ID}`).set(authHeader());

    expect(response.status).toBe(404);
    expect(mockedBug.deleteOne).not.toHaveBeenCalled();
  });
});
