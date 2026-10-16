import type { Response } from 'express';
import type { ZodError } from 'zod';

/** Sends the standard `{ error: { code, message } }` payload used across the API. */
export function sendError(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message } });
}

/** Sends a 400 with per-field details for a failed Zod parse. */
export function sendValidationError(res: Response, error: ZodError): void {
  res.status(400).json({
    error: {
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      details: error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    },
  });
}
