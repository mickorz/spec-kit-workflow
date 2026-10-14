import type { Request, Response, NextFunction } from 'express';
import type { SessionService, TokenPayload } from '../services/session-service.js';
import { AppError } from '../utils/app-error.js';
import { ErrorMessages } from '../utils/error-messages.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: TokenPayload;
      timing?: number;
    }
  }
}

export function authenticate(sessionService: SessionService) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        error: { code: 'NO_TOKEN', message: ErrorMessages.NO_TOKEN },
      });
      return;
    }

    const token = authHeader.slice(7);
    try {
      const payload = sessionService.verify(token);
      req.user = payload;
      next();
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.statusCode).json({
          error: { code: err.code, message: err.message },
        });
        return;
      }
      res.status(401).json({
        error: { code: 'TOKEN_INVALID', message: ErrorMessages.TOKEN_INVALID },
      });
    }
  };
}

export function requireRole(role: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !req.user.roles || !req.user.roles.includes(role)) {
      res.status(403).json({
        error: { code: 'FORBIDDEN', message: ErrorMessages.FORBIDDEN },
      });
      return;
    }
    next();
  };
}
