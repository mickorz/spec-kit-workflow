import { describe, it, expect, beforeEach } from 'vitest';
import { createTestContext, seedUser, type TestContext } from './helpers/test-setup.js';
import { AuditEventType } from '../src/models/audit-log-entry.js';

describe('FR-004: 锁定状态判定与恢复', () => {
  let ctx: TestContext;
  let userId: string;

  beforeEach(async () => {
    ctx = createTestContext({ costFactor: 4 });
    const user = await seedUser(ctx, { username: 'alice', password: 'P@ssw0rd123' });
    userId = user.id;
  });

  describe('AC-013: 锁定到期自动解锁', () => {
    it('锁定时长到期后，下一次登录请求触发自动解锁，失败计数清零', async () => {
      const lockDurationMs = 15 * 60 * 1000;
      ctx.lockoutService.setLockState(userId, {
        lockedAt: ctx.clock.now(),
        lockDurationMs,
        failedAttempts: 3,
      });

      ctx.clock.advance(lockDurationMs + 1000);

      const status = ctx.lockoutService.checkLockStatus(userId);
      expect(status.locked).toBe(false);

      expect(ctx.lockoutService.getFailedAttempts(userId)).toBe(0);

      const autoUnlockLogs = ctx.auditService.getEntriesByType(AuditEventType.AUTO_UNLOCK);
      expect(autoUnlockLogs.length).toBe(1);
      expect(autoUnlockLogs[0].userId).toBe(userId);
    });

    it('自动解锁后可正常登录', async () => {
      const lockDurationMs = 15 * 60 * 1000;
      ctx.lockoutService.setLockState(userId, {
        lockedAt: ctx.clock.now(),
        lockDurationMs,
        failedAttempts: 3,
      });

      ctx.clock.advance(lockDurationMs + 1);

      const result = await ctx.authService.login({
        username: 'alice',
        password: 'P@ssw0rd123',
      });
      expect(result.token).toBeDefined();
    });
  });

  describe('AC-014: 锁定到期边界精确性', () => {
    it('剩余时间不足 1 秒时仍视为锁定中', () => {
      const lockDurationMs = 15 * 60 * 1000;
      ctx.lockoutService.setLockState(userId, {
        lockedAt: ctx.clock.now(),
        lockDurationMs,
        failedAttempts: 3,
      });

      ctx.clock.advance(lockDurationMs - 500);

      const status = ctx.lockoutService.checkLockStatus(userId);
      expect(status.locked).toBe(true);
      expect(status.remainingMs).toBeGreaterThan(0);
      expect(status.remainingMs!).toBeLessThanOrEqual(500);
    });

    it('满 1 倍锁定时长后解锁', () => {
      const lockDurationMs = 15 * 60 * 1000;
      ctx.lockoutService.setLockState(userId, {
        lockedAt: ctx.clock.now(),
        lockDurationMs,
        failedAttempts: 3,
      });

      ctx.clock.advance(lockDurationMs);

      const status = ctx.lockoutService.checkLockStatus(userId);
      expect(status.locked).toBe(false);
    });

    it('剩余时间刚好为 1 毫秒时仍锁定', () => {
      const lockDurationMs = 10000;
      ctx.lockoutService.setLockState(userId, {
        lockedAt: ctx.clock.now(),
        lockDurationMs,
        failedAttempts: 3,
      });

      ctx.clock.advance(9999);

      const status = ctx.lockoutService.checkLockStatus(userId);
      expect(status.locked).toBe(true);
      expect(status.remainingMs).toBe(1);
    });
  });

  describe('AC-015: 永久锁定', () => {
    it('永久锁定的账号即使经过任意时长仍保持锁定', () => {
      ctx.lockoutService.setLockState(userId, {
        lockedAt: ctx.clock.now(),
        lockDurationMs: 0,
        permanent: true,
        failedAttempts: 5,
      });

      ctx.clock.advance(365 * 24 * 60 * 60 * 1000);

      const status = ctx.lockoutService.checkLockStatus(userId);
      expect(status.locked).toBe(true);
      expect(status.permanent).toBe(true);
    });

    it('永久锁定的账号即使密码正确也无法登录', async () => {
      ctx.lockoutService.setLockState(userId, {
        lockedAt: ctx.clock.now(),
        lockDurationMs: 0,
        permanent: true,
        failedAttempts: 5,
      });

      await expect(
        ctx.authService.login({ username: 'alice', password: 'P@ssw0rd123' }),
      ).rejects.toMatchObject({
        code: 'ACCOUNT_LOCKED_PERMANENT',
        statusCode: 403,
      });
    });

    it('永久锁定仅管理员手动解锁可恢复', () => {
      ctx.lockoutService.setLockState(userId, {
        lockedAt: ctx.clock.now(),
        lockDurationMs: 0,
        permanent: true,
        failedAttempts: 5,
      });

      ctx.clock.advance(365 * 24 * 60 * 60 * 1000);

      ctx.lockoutService.adminUnlock(userId);

      const status = ctx.lockoutService.checkLockStatus(userId);
      expect(status.locked).toBe(false);
      expect(ctx.lockoutService.getFailedAttempts(userId)).toBe(0);
    });
  });

  describe('AC-016: 多次锁定周期独立计算', () => {
    it('锁定到期后再锁定，锁定时长不叠加', () => {
      const lockDurationMs = 15 * 60 * 1000;

      ctx.lockoutService.setLockState(userId, {
        lockedAt: ctx.clock.now(),
        lockDurationMs,
        failedAttempts: 5,
      });
      ctx.clock.advance(lockDurationMs + 1);
      ctx.lockoutService.checkLockStatus(userId);

      expect(ctx.lockoutService.getFailedAttempts(userId)).toBe(0);

      const secondLockTime = ctx.clock.now();
      ctx.lockoutService.setLockState(userId, {
        lockedAt: secondLockTime,
        lockDurationMs,
        failedAttempts: 3,
      });

      const status = ctx.lockoutService.checkLockStatus(userId);
      expect(status.locked).toBe(true);

      ctx.clock.advance(lockDurationMs - 1);
      const status2 = ctx.lockoutService.checkLockStatus(userId);
      expect(status2.locked).toBe(true);

      ctx.clock.advance(2);
      const status3 = ctx.lockoutService.checkLockStatus(userId);
      expect(status3.locked).toBe(false);
    });

    it('多次锁定周期的 lockedAt 每次重新设置', () => {
      const lockDurationMs = 15 * 60 * 1000;

      const firstLockAt = ctx.clock.now();
      ctx.lockoutService.setLockState(userId, {
        lockedAt: firstLockAt,
        lockDurationMs,
        failedAttempts: 5,
      });

      ctx.clock.advance(lockDurationMs + 1);
      ctx.lockoutService.checkLockStatus(userId);

      ctx.clock.advance(60 * 1000);
      const secondLockAt = ctx.clock.now();
      ctx.lockoutService.setLockState(userId, {
        lockedAt: secondLockAt,
        lockDurationMs,
        failedAttempts: 3,
      });

      const lock = ctx.lockStore.get(userId)!;
      expect(lock.lockedAt).toBe(secondLockAt);
      expect(secondLockAt).toBeGreaterThan(firstLockAt);
    });
  });
});
