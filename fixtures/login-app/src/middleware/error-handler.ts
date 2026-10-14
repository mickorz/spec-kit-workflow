import type { Request, Response, NextFunction } from 'express';
import { AppError, isAppError } from '../utils/app-error.js';
import { ErrorMessages } from '../utils/error-messages.js';

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  if (isAppError(err)) {
    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
      },
    });
    return;
  }
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: ErrorMessages.INTERNAL_ERROR,
    },
  });
}
