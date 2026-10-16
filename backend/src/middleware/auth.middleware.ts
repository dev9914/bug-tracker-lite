import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { getJwtSecret } from '../config/env.js';

// Tokens are issued with a MongoDB ObjectId as the subject. Re-checking the
// shape here stops a malformed subject from reaching image-key regexes or
// database queries.
const USER_ID_PATTERN = /^[0-9a-f]{24}$/i;

function respondUnauthorized(res: Response, message: string): void {
  res.status(401).json({ error: { code: 'UNAUTHORIZED', message } });
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    respondUnauthorized(res, 'Missing Bearer token');
    return;
  }

  const token = header.slice('Bearer '.length).trim();
  const secret = getJwtSecret();

  try {
    const payload = jwt.verify(token, secret);

    if (typeof payload === 'string' || !payload.sub || !USER_ID_PATTERN.test(payload.sub)) {
      respondUnauthorized(res, 'Invalid or expired token');
      return;
    }

    req.userId = payload.sub;
    next();
  } catch {
    respondUnauthorized(res, 'Invalid or expired token');
  }
}
