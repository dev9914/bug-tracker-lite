import type { NextFunction, Request, Response } from 'express';

function resolveStatus(error: unknown): number {
  const status = (error as { status?: unknown } | null)?.status;

  return typeof status === 'number' && status >= 400 && status < 500 ? status : 500;
}

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction): void {
  const status = resolveStatus(error);

  if (status >= 500) {
    console.error(error);
  }

  const message = status >= 500 ? 'Internal server error' : error instanceof Error ? error.message : 'Bad request';

  res.status(status).json({
    error: {
      code: status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST',
      message,
    },
  });
}
