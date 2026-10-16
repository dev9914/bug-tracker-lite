import cors from 'cors';
import express, { type ErrorRequestHandler, type Express, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { errorHandler } from './middleware/error.middleware.js';
import { authRouter } from './routes/auth.routes.js';
import { bugRouter } from './routes/bug.routes.js';
import { uploadRouter } from './routes/upload.routes.js';

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173';

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  // One Elastic Beanstalk nginx proxy hop terminates TLS and forwards the request,
  // so trust exactly that one proxy to resolve the real client IP for rate limiting.
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: FRONTEND_URL }));
  app.use(express.json({ limit: '100kb' }));
  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      limit: 100,
      standardHeaders: true,
      legacyHeaders: false,
      // Infrastructure health checks must not consume the API rate limit.
      skip: (req) => req.path === '/health',
    }),
  );

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/bugs', bugRouter);
  app.use('/api/uploads', uploadRouter);

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });

  app.use(errorHandler as ErrorRequestHandler);

  return app;
}

export const app = createApp();
