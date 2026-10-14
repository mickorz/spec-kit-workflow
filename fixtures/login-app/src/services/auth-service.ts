import type { PasswordHasher, PasswordHasherRegistry } from './password-hasher.js';
import type { UserRepository } from '../repositories/user-repository.js';
import type { LockoutService } from './lockout-service.js';
import type { SessionService } from './session-service.js';
import type { SessionResult } from './session-service.js';
import type { AuditService } from './audit-service.js';
import type { AuthConfig } from '../config/auth-config.js';
import type { PasswordMigrationService } from './password-migration.js';
import { AuditEventType } from '../models/audit-log-entry.js';
import { AppError } from '../utils/app-error.js';
import { ErrorMessages, accountLockedMessage } from '../utils/error-messages.js';

export interface LoginInput {
  username: string;
  password: string;
  ip?: string;
}

export interface LoginResult {
  token: string;
  expiresIn: number;
  expiresAt: number;
  user: {
    id: string;
    username: string;
    roles: string[];
  };
}

export class AuthService {
  constructor(
    private userRepo: UserRepository,
    private hasherRegistry: PasswordHasherRegistry,
    private lockoutService: LockoutService,
    private sessionService: SessionService,
    private authConfig: AuthConfig,
    private auditService: AuditService,
    private migrationService: PasswordMigrationService,
  ) {}

  /**
   * 登录认证编排逻辑 (FR-001)
   *
   * 数据流：
   *   zod 校验 (handler 层)
   *     -> LockoutService.checkLockStatus(userId) [FR-004 前置]
   *     -> UserRepository.findByUsername(username)
   *       |- 不存在 -> 统一错误 "用户名或密码错误" (AC-002)
   *       |- 存在 -> 检查状态
   *            |- disabled -> "账号已被禁用" (AC-003)
   *            |- enabled -> PasswordHasher.verify(password, hash)
   *                 |- 不匹配 -> 失败计数 +1 [FR-002] -> 若达阈值则锁定 [FR-003] -> 统一错误或锁定提示
   *                 |- 匹配 -> 失败计数清零 [FR-002] -> 密码迁移 [FR-006 AC-023] -> SessionService.create -> 返回 Token
   */
  async login(input: LoginInput): Promise<LoginResult> {
    const { username, password, ip } = input;

    const user = await this.userRepo.findByUsername(username, {
      caseSensitive: this.authConfig.isCaseSensitive(),
    });

    if (user) {
      const lockStatus = this.lockoutService.checkLockStatus(user.id);
      if (lockStatus.locked) {
        if (lockStatus.permanent) {
          throw new AppError('ACCOUNT_LOCKED_PERMANENT', 403, ErrorMessages.ACCOUNT_LOCKED_PERMANENT);
        }
        throw new AppError('ACCOUNT_LOCKED', 403, accountLockedMessage(lockStatus.remainingMinutes!));
      }
    }

    if (!user) {
      this.auditService.log(AuditEventType.LOGIN_FAILED, undefined, ip, 'failed', { reason: 'user_not_found' });
      throw new AppError('INVALID_CREDENTIALS', 401, ErrorMessages.INVALID_CREDENTIALS);
    }

    if (user.status === 'disabled') {
      throw new AppError('ACCOUNT_DISABLED', 403, ErrorMessages.ACCOUNT_DISABLED);
    }

    const storedHash = user.passwordHash;
    const detectedAlgo = this.hasherRegistry.detectAlgorithm(storedHash);
    const hasher = this.hasherRegistry.get(detectedAlgo ?? undefined);
    const passwordMatch = await hasher.verify(password, storedHash);

    if (!passwordMatch) {
      const result = this.lockoutService.recordFailure(user.id, ip);

      if (result.locked) {
        if (result.permanent) {
          this.auditService.log(AuditEventType.LOGIN_FAILED, user.id, ip, 'failed', { failedAttempts: result.failedAttempts, locked: true });
          throw new AppError('ACCOUNT_LOCKED_PERMANENT', 403, ErrorMessages.ACCOUNT_LOCKED_PERMANENT);
        }
        this.auditService.log(AuditEventType.LOGIN_FAILED, user.id, ip, 'failed', { failedAttempts: result.failedAttempts, locked: true });
        throw new AppError('ACCOUNT_LOCKED', 403, accountLockedMessage(result.remainingMinutes));
      }

      this.auditService.log(AuditEventType.LOGIN_FAILED, user.id, ip, 'failed', { failedAttempts: result.failedAttempts });
      throw new AppError('INVALID_CREDENTIALS', 401, ErrorMessages.INVALID_CREDENTIALS);
    }

    this.lockoutService.resetFailures(user.id);

    await this.migrationService.migrateIfNeeded(user.id, password, storedHash);

    const session = this.sessionService.create(user.id, user.roles);

    this.auditService.log(AuditEventType.LOGIN_SUCCESS, user.id, ip, 'success');

    return {
      token: session.token,
      expiresIn: session.expiresIn,
      expiresAt: session.expiresAt,
      user: {
        id: user.id,
        username: user.username,
        roles: user.roles,
      },
    };
  }
}
