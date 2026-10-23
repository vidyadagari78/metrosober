import { Request, Response, NextFunction } from 'express';

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  const statusCode = err.statusCode || (err.status ? err.status : 500);
  const message = err.message || 'Internal Server Error';

  if (statusCode >= 500) {
    console.error('Server error:', err);
  }

  res.status(statusCode).json({
    error: err.name || 'Error',
    message,
    ...(err.statusCode ? {} : { stack: process.env.NODE_ENV === 'development' ? err.stack : undefined }),
  });
}
