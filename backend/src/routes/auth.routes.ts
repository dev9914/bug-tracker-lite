import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { login, signup } from '../controllers/auth.controller.js';

// Stricter than the global limiter: 5 auth attempts per minute per IP.
export const authRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: { code: 'TOO_MANY_REQUESTS', message: 'Too many authentication attempts, please try again later' },
  },
});

export const authRouter = Router();

authRouter.post('/signup', authRateLimiter, signup);
authRouter.post('/login', authRateLimiter, login);
