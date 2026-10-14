import type { Request, Response, NextFunction } from 'express';
import type { AuthService } from '../services/auth-service.js';
import { validateLoginInput } from '../schemas/login-schema.js';
import { AppError } from '../utils/app-error.js';
import { ErrorMessages } from '../utils/error-messages.js';

export function createLoginHandler(authService: AuthService) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const validation = validateLoginInput(req.body);
      if (!validation.success) {
        throw new AppError('VALIDATION_ERROR', 400, ErrorMessages.VALIDATION_ERROR);
      }

      const result = await authService.login({
        username: validation.data.username,
        password: validation.data.password,
        ip: req.ip,
      });

      res.json({
        token: result.token,
        expiresIn: result.expiresIn,
        expiresAt: result.expiresAt,
        user: result.user,
      });
    } catch (err) {
      next(err);
    }
  };
}
