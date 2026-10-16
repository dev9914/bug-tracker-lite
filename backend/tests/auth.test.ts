import bcrypt from 'bcryptjs';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/app.js';
import { requireAuth } from '../src/middleware/auth.middleware.js';
import { UserModel } from '../src/models/user.model.js';

// The auth limiter allows only 5 requests/minute per IP, which the suite would exceed,
// so it is replaced with a pass-through. Rate limiting is not what these tests cover.
vi.mock('express-rate-limit', () => ({
  default: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// Unit tests must not need a real MongoDB connection.
vi.mock('../src/models/user.model.js', () => ({
  UserModel: {
    create: vi.fn(),
    findOne: vi.fn(),
  },
}));

const mockedUser = UserModel as unknown as {
  create: ReturnType<typeof vi.fn>;
  findOne: ReturnType<typeof vi.fn>;
};

const ORIGINAL_ENV = {
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN,
};

process.env.JWT_SECRET = 'test-secret';
process.env.JWT_EXPIRES_IN = '1h';

const PASSWORD = 'Password123';
const USER_ID = '64b7f1c2a1b2c3d4e5f60718';

const protectedApp = express();
protectedApp.get('/protected', requireAuth, (req, res) => {
  res.status(200).json({ userId: req.userId });
});

let passwordHash: string;

beforeEach(async () => {
  vi.clearAllMocks();
  passwordHash = await bcrypt.hash(PASSWORD, 10);
});

afterAll(() => {
  process.env.JWT_SECRET = ORIGINAL_ENV.JWT_SECRET;
  process.env.JWT_EXPIRES_IN = ORIGINAL_ENV.JWT_EXPIRES_IN;
});

describe('POST /api/auth/signup', () => {
  it('creates a user, hashes the password and returns a token', async () => {
    mockedUser.create.mockResolvedValue({ id: USER_ID, name: 'Ada Lovelace', email: 'ada@example.com' });

    const response = await request(app)
      .post('/api/auth/signup')
      .send({ name: 'Ada Lovelace', email: 'ada@example.com', password: PASSWORD });

    expect(response.status).toBe(201);
    expect(response.body.user).toEqual({ id: USER_ID, name: 'Ada Lovelace', email: 'ada@example.com' });
    expect(typeof response.body.token).toBe('string');

    const decoded = jwt.verify(response.body.token, 'test-secret') as jwt.JwtPayload;
    expect(decoded.sub).toBe(USER_ID);

    // The stored hash must be a bcrypt hash, never the plaintext password.
    const stored = mockedUser.create.mock.calls[0][0] as { passwordHash: string };
    expect(stored.passwordHash).not.toBe(PASSWORD);
    expect(stored.passwordHash.startsWith('$2')).toBe(true);
    expect(response.body).not.toHaveProperty('password');
    expect(response.body).not.toHaveProperty('passwordHash');
  });

  it('normalizes the email to lowercase before saving', async () => {
    mockedUser.create.mockResolvedValue({ id: USER_ID, name: 'Ada', email: 'ada@example.com' });

    await request(app)
      .post('/api/auth/signup')
      .send({ name: 'Ada', email: 'Ada@Example.com', password: PASSWORD });

    expect(mockedUser.create).toHaveBeenCalledWith(expect.objectContaining({ email: 'ada@example.com' }));
  });

  it('returns 400 for validation failures', async () => {
    const response = await request(app)
      .post('/api/auth/signup')
      .send({ name: 'A', email: 'not-an-email', password: 'short' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(mockedUser.create).not.toHaveBeenCalled();
  });

  it('returns 409 when the email is already registered', async () => {
    mockedUser.create.mockRejectedValue(Object.assign(new Error('duplicate'), { code: 11000 }));

    const response = await request(app)
      .post('/api/auth/signup')
      .send({ name: 'Ada', email: 'ada@example.com', password: PASSWORD });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('EMAIL_IN_USE');
  });
});

describe('POST /api/auth/login', () => {
  it('returns a token for valid credentials', async () => {
    mockedUser.findOne.mockResolvedValue({
      id: USER_ID,
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      passwordHash,
    });

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ada@example.com', password: PASSWORD });

    expect(response.status).toBe(200);
    expect(response.body.user).toEqual({ id: USER_ID, name: 'Ada Lovelace', email: 'ada@example.com' });
    expect(typeof response.body.token).toBe('string');
  });

  it('returns 401 for a wrong password', async () => {
    mockedUser.findOne.mockResolvedValue({
      id: USER_ID,
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      passwordHash,
    });

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ada@example.com', password: 'WrongPassword1' });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('returns 401 when the email is unknown', async () => {
    mockedUser.findOne.mockResolvedValue(null);

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: PASSWORD });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('returns 400 for validation failures', async () => {
    const response = await request(app).post('/api/auth/login').send({ email: 'nope', password: '' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(mockedUser.findOne).not.toHaveBeenCalled();
  });
});

describe('requireAuth middleware', () => {
  it('returns 401 when the Authorization header is missing', async () => {
    const response = await request(protectedApp).get('/protected');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 for an invalid token', async () => {
    const response = await request(protectedApp).get('/protected').set('Authorization', 'Bearer not-a-jwt');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 for a token signed with the wrong secret', async () => {
    const token = jwt.sign({ sub: USER_ID }, 'some-other-secret', { expiresIn: '1h' });

    const response = await request(protectedApp).get('/protected').set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(401);
  });

  it('returns 401 for an expired token', async () => {
    // Signed with the correct secret but an `exp` in the past, so only expiry can reject it.
    const token = jwt.sign({ sub: USER_ID, exp: Math.floor(Date.now() / 1000) - 60 }, 'test-secret');

    const response = await request(protectedApp).get('/protected').set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  it('attaches the user id for a valid token', async () => {
    const token = jwt.sign({ sub: USER_ID }, 'test-secret', { expiresIn: '1h' });

    const response = await request(protectedApp).get('/protected').set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ userId: USER_ID });
  });

  it.each(['not-an-object-id', '../../etc/passwd', '123'])(
    'returns 401 when the token subject is not a valid user id (%s)',
    async (sub) => {
      const token = jwt.sign({ sub }, 'test-secret', { expiresIn: '1h' });

      const response = await request(protectedApp).get('/protected').set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    },
  );

  it('returns 401 when the token has no subject', async () => {
    const token = jwt.sign({}, 'test-secret', { expiresIn: '1h' });

    const response = await request(protectedApp).get('/protected').set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });
});
