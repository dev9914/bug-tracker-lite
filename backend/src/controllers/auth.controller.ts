import bcrypt from 'bcryptjs';
import type { NextFunction, Request, Response } from 'express';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { getJwtExpiresIn, getJwtSecret } from '../config/env.js';
import { UserModel, type UserDocument } from '../models/user.model.js';
import { loginSchema, signupSchema } from '../schemas/auth.schema.js';
import { sendError, sendValidationError } from '../utils/http.js';

const SALT_ROUNDS = 10;

function toPublicUser(user: UserDocument) {
  return { id: user.id, name: user.name, email: user.email };
}

function createToken(userId: string): string {
  const expiresIn = getJwtExpiresIn() as SignOptions['expiresIn'];

  return jwt.sign({ sub: userId }, getJwtSecret(), { expiresIn });
}

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000;
}

export async function signup(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = signupSchema.safeParse(req.body);

    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    const { name, email, password } = parsed.data;
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const user = await UserModel.create({ name, email, passwordHash });

    res.status(201).json({ token: createToken(user.id), user: toPublicUser(user) });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      sendError(res, 409, 'EMAIL_IN_USE', 'An account with this email already exists');
      return;
    }

    next(error);
  }
}

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = loginSchema.safeParse(req.body);

    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    const { email, password } = parsed.data;
    const user = await UserModel.findOne({ email });

    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      sendError(res, 401, 'INVALID_CREDENTIALS', 'Invalid email or password');
      return;
    }

    res.status(200).json({ token: createToken(user.id), user: toPublicUser(user) });
  } catch (error) {
    next(error);
  }
}
