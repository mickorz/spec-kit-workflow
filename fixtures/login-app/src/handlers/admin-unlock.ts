import type { Request, Response, NextFunction } from 'express';
import type { LockoutService } from '../services/lockout-service.js';
import type { UserRepository } from '../repositories/user-repository.js';
import { AppError } from '../utils/app-error.js';
import { ErrorMessages } from '../utils/error-messages.js';

export function createAdminUnlockHandler(
  lockoutService: LockoutService,
  userRepo: UserRepository,
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = String(req.params.userId);
      const exists = await userRepo.exists(userId);
      if (!exists) {
        throw new AppError('ACCOUNT_NOT_FOUND', 404, ErrorMessages.ACCOUNT_NOT_FOUND);
      }
      lockoutService.adminUnlock(userId);
      res.json({ message: '解锁成功' });
    } catch (err) {
      next(err);
    }
  };
}
