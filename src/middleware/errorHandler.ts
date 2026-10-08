import type { Request, Response, NextFunction } from 'express';
import { env } from '../config/env.js';

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  console.error('[Server] Unhandled server error:', err);

  const status = (err as any).statusCode || 500;
  const message = err.message || 'Internal Server Error';

  res.status(status).json({
    status: 'error',
    message,
    ...(env.NODE_ENV === 'development' ? { stack: err.stack } : {}),
  });
}
