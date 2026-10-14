import type { Request, Response, NextFunction } from 'express';
import type { SessionService } from '../services/session-service.js';
import { AppError } from '../utils/app-error.js';
import { ErrorMessages } from '../utils/error-messages.js';

export function createLogoutHandler(sessionService: SessionService) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      if (!req.user) {
        throw new AppError('NO_TOKEN', 401, ErrorMessages.NO_TOKEN);
      }
      const jti = req.user.jti;
      const userId = req.user.sub;
      sessionService.revoke(jti, userId);
      res.json({ message: '登出成功' });
    } catch (err) {
      next(err);
    }
  };
}
