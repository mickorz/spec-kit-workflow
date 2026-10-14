import type { Clock } from '../utils/clock.js';
import type { AuditService } from './audit-service.js';
import { AuditEventType } from '../models/audit-log-entry.js';
import type { AccountLock, LockStatus } from '../models/account-lock.js';
import { createAccountLock } from '../models/account-lock.js';
import type { AccountLockStore } from '../repositories/account-lock-store.js';
import type { LockoutConfig } from '../config/lockout-config.js';

export interface RecordFailureResult {
  failedAttempts: number;
  locked: boolean;
  permanent: boolean;
  remainingMinutes: number;
  threshold: number;
}

export class LockoutService {
  constructor(
    private store: AccountLockStore,
    private clock: Clock,
    private auditService: AuditService,
    private lockoutConfig: LockoutConfig,
  ) {}

  private getOrCreate(userId: string): AccountLock {
    let lock = this.store.get(userId);
    if (!lock) {
      lock = createAccountLock(userId);
      this.store.save(userId, lock);
    }
    return lock;
  }

  /**
   * 记录登录失败，累加失败计数 (FR-002 AC-006)
   * 失败次数达到阈值时自动锁定账号 (FR-003 AC-009)
   * 锁定阈值为可配置参数，最小值 3 (AC-011)
   * 锁定时长为可配置参数，默认 15 分钟，0 表示永久锁定 (AC-012)
   */
  recordFailure(userId: string, ip?: string): RecordFailureResult {
    const lock = this.getOrCreate(userId);
    lock.failedAttempts += 1;

    const threshold = this.lockoutConfig.getThreshold();
    const durationMinutes = this.lockoutConfig.getDurationMinutes();
    const permanent = durationMinutes === 0;

    let locked = false;

    if (lock.failedAttempts >= threshold && lock.lockedAt === null) {
      lock.lockedAt = this.clock.now();
      lock.lockDurationMs = permanent ? 0 : this.lockoutConfig.getDurationMs();
      lock.permanent = permanent;
      locked = true;

      this.auditService.log(
        AuditEventType.LOCK_TRIGGERED,
        userId,
        ip,
        'success',
        { failedAttempts: lock.failedAttempts, threshold },
      );
    }

    this.store.save(userId, lock);

    const remainingMinutes = permanent ? 0 : Math.ceil(lock.lockDurationMs / 60000);

    return {
      failedAttempts: lock.failedAttempts,
      locked,
      permanent,
      remainingMinutes,
      threshold,
    };
  }

  /**
   * 重置失败计数 (FR-002 AC-007)
   * 登录成功后调用，清零连续失败次数
   */
  resetFailures(userId: string): void {
    const lock = this.getOrCreate(userId);
    lock.failedAttempts = 0;
    this.store.save(userId, lock);
  }

  /**
   * 检查账号锁定状态 (FR-004)
   * 在每次登录请求入口处调用，作为认证流程的前置关卡
   * - permanent === true -> 返回永久锁定 (AC-015)
   * - lockedAt == null -> 未锁定，放行
   * - remaining > 0 -> 仍锁定中 (AC-014: 不足1秒仍视为锁定)
   * - remaining <= 0 -> 锁定到期，自动解锁 (AC-013)
   */
  checkLockStatus(userId: string): LockStatus {
    const lock = this.store.get(userId);
    if (!lock || lock.lockedAt === null) {
      return { locked: false };
    }

    if (lock.permanent) {
      return { locked: true, permanent: true };
    }

    const now = this.clock.now();
    const elapsed = now - lock.lockedAt;
    const remaining = lock.lockDurationMs - elapsed;

    if (remaining > 0) {
      const remainingMinutes = Math.ceil(remaining / 60000);
      return { locked: true, remainingMs: remaining, remainingMinutes };
    }

    this.unlockInternal(userId, lock);
    this.auditService.log(AuditEventType.AUTO_UNLOCK, userId, undefined, 'success');
    return { locked: false };
  }

  /**
   * 自动解锁：清除锁定状态并重置失败计数 (FR-004 AC-013)
   */
  private unlockInternal(userId: string, lock: AccountLock): void {
    lock.lockedAt = null;
    lock.lockDurationMs = 0;
    lock.permanent = false;
    lock.failedAttempts = 0;
    this.store.save(userId, lock);
  }

  /**
   * 管理员手动解锁 (FR-005 AC-017/AC-019)
   * 强制清除锁定状态并重置失败计数，不受 permanent 标志限制
   * 对未锁定账号同样执行清除操作，幂等成功
   */
  adminUnlock(userId: string): void {
    const lock = this.getOrCreate(userId);
    lock.lockedAt = null;
    lock.lockDurationMs = 0;
    lock.permanent = false;
    lock.failedAttempts = 0;
    this.store.save(userId, lock);
    this.auditService.log(AuditEventType.ADMIN_UNLOCK, userId, undefined, 'success');
  }

  getFailedAttempts(userId: string): number {
    const lock = this.store.get(userId);
    return lock?.failedAttempts ?? 0;
  }

  isLocked(userId: string): boolean {
    const status = this.checkLockStatus(userId);
    return status.locked;
  }

  /**
   * 直接设置账号锁定状态 (测试/管理用)
   * 用于在不经过失败计数阈值的情况下手动锁定账号
   */
  setLockState(userId: string, opts: { lockedAt: number; lockDurationMs: number; permanent?: boolean; failedAttempts?: number }): void {
    const lock = this.getOrCreate(userId);
    lock.lockedAt = opts.lockedAt;
    lock.lockDurationMs = opts.lockDurationMs;
    lock.permanent = opts.permanent ?? false;
    lock.failedAttempts = opts.failedAttempts ?? lock.failedAttempts;
    this.store.save(userId, lock);
  }
}
