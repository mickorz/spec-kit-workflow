import { describe, it, expect, beforeEach } from 'vitest';
import { createTestContext, seedUser, type TestContext } from './helpers/test-setup.js';
import { AuditEventType } from '../src/models/audit-log-entry.js';
import { ErrorMessages, accountLockedMessage } from '../src/utils/error-messages.js';

describe('FR-003: 失败次数累计与账号锁定', () => {
  let ctx: TestContext;
  let userId: string;

  beforeEach(async () => {
    ctx = createTestContext({ costFactor: 4, lockoutThreshold: 5, lockoutDurationMinutes: 15 });
    const user = await seedUser(ctx, { username: 'alice', password: 'P@ssw0rd123' });
    userId = user.id;
  });

  describe('AC-009: 失败次数达阈值自动锁定', () => {
    it('失败次数累计达到阈值时账号状态切换为锁定', async () => {
      for (let i = 0; i < 4; i++) {
        await ctx.authService.login({ username: 'alice', password: 'wrong' }).catch(() => {});
      }
      expect(ctx.lockoutService.getFailedAttempts(userId)).toBe(4);
      expect(ctx.lockoutService.checkLockStatus(userId).locked).toBe(false);

      await ctx.authService.login({ username: 'alice', password: 'wrong' }).catch(() => {});

      const status = ctx.lockoutService.checkLockStatus(userId);
      expect(status.locked).toBe(true);
      expect(status.remainingMinutes).toBeGreaterThan(0);
    });

    it('触发锁定时返回锁定提示而非统一错误提示', async () => {
      for (let i = 0; i < 4; i++) {
        await ctx.authService.login({ username: 'alice', password: 'wrong' }).catch(() => {});
      }

      const error = await ctx.authService.login({ username: 'alice', password: 'wrong' }).catch((e) => e);

      expect(error.code).toBe('ACCOUNT_LOCKED');
      expect(error.statusCode).toBe(403);
      expect(error.message).toContain('账号已锁定');
    });

    it('锁定后后续登录请求被直接拒绝，返回剩余锁定时间', async () => {
      for (let i = 0; i < 5; i++) {
        await ctx.authService.login({ username: 'alice', password: 'wrong' }).catch(() => {});
      }

      const error = await ctx.authService.login({ username: 'alice', password: 'P@ssw0rd123' }).catch((e) => e);

      expect(error.code).toBe('ACCOUNT_LOCKED');
      expect(error.statusCode).toBe(403);
      expect(error.message).toContain('分钟');
    });

    it('锁定触发时记录 LOCK_TRIGGERED 审计日志', async () => {
      for (let i = 0; i < 5; i++) {
        await ctx.authService.login({ username: 'alice', password: 'wrong', ip: '10.0.0.1' }).catch(() => {});
      }

      const lockLogs = ctx.auditService.getEntriesByType(AuditEventType.LOCK_TRIGGERED);
      expect(lockLogs.length).toBe(1);
      expect(lockLogs[0].userId).toBe(userId);
      expect(lockLogs[0].ip).toBe('10.0.0.1');
      expect(lockLogs[0].result).toBe('success');
      expect(lockLogs[0].meta).toBeDefined();
      expect(lockLogs[0].meta!.threshold).toBe(5);
    });
  });

  describe('AC-010: 锁定期间正确密码仍被拒绝，失败计数不增加', () => {
    it('锁定期间即使输入正确密码登录仍被拒绝', async () => {
      for (let i = 0; i < 5; i++) {
        await ctx.authService.login({ username: 'alice', password: 'wrong' }).catch(() => {});
      }

      const attemptsBefore = ctx.lockoutService.getFailedAttempts(userId);

      await expect(
        ctx.authService.login({ username: 'alice', password: 'P@ssw0rd123' }),
      ).rejects.toMatchObject({
        code: 'ACCOUNT_LOCKED',
        statusCode: 403,
      });

      expect(ctx.lockoutService.getFailedAttempts(userId)).toBe(attemptsBefore);
    });

    it('锁定期间继续尝试错误密码不增加失败计数', async () => {
      for (let i = 0; i < 5; i++) {
        await ctx.authService.login({ username: 'alice', password: 'wrong' }).catch(() => {});
      }

      const attemptsBefore = ctx.lockoutService.getFailedAttempts(userId);

      await ctx.authService.login({ username: 'alice', password: 'wrong' }).catch(() => {});

      expect(ctx.lockoutService.getFailedAttempts(userId)).toBe(attemptsBefore);
    });
  });

  describe('AC-011: 锁定阈值可配置，最小值 3', () => {
    it('修改阈值后对新触发的锁定生效', async () => {
      ctx.lockoutConfig.setThreshold(3);

      for (let i = 0; i < 2; i++) {
        await ctx.authService.login({ username: 'alice', password: 'wrong' }).catch(() => {});
      }
      expect(ctx.lockoutService.checkLockStatus(userId).locked).toBe(false);

      await ctx.authService.login({ username: 'alice', password: 'wrong' }).catch(() => {});

      expect(ctx.lockoutService.checkLockStatus(userId).locked).toBe(true);
    });

    it('阈值低于 3 时按 3 处理', async () => {
      ctx.lockoutConfig.setThreshold(1);

      expect(ctx.lockoutConfig.getThreshold()).toBe(3);

      await ctx.authService.login({ username: 'alice', password: 'wrong' }).catch(() => {});
      expect(ctx.lockoutService.checkLockStatus(userId).locked).toBe(false);

      await ctx.authService.login({ username: 'alice', password: 'wrong' }).catch(() => {});
      expect(ctx.lockoutService.checkLockStatus(userId).locked).toBe(false);

      await ctx.authService.login({ username: 'alice', password: 'wrong' }).catch(() => {});
      expect(ctx.lockoutService.checkLockStatus(userId).locked).toBe(true);
    });

    it('默认阈值为 5', () => {
      expect(ctx.lockoutConfig.getThreshold()).toBe(5);
    });

    it('动态调整阈值不重启服务', async () => {
      ctx.lockoutConfig.setThreshold(10);

      for (let i = 0; i < 5; i++) {
        await ctx.authService.login({ username: 'alice', password: 'wrong' }).catch(() => {});
      }
      expect(ctx.lockoutService.checkLockStatus(userId).locked).toBe(false);

      ctx.lockoutConfig.setThreshold(5);
      await ctx.authService.login({ username: 'alice', password: 'wrong' }).catch(() => {});
      expect(ctx.lockoutService.checkLockStatus(userId).locked).toBe(true);
    });
  });

  describe('AC-012: 锁定时长可配置，默认 15 分钟，0 为永久锁定', () => {
    it('默认锁定时长为 15 分钟', () => {
      expect(ctx.lockoutConfig.getDurationMinutes()).toBe(15);
    });

    it('锁定时长可配置修改', async () => {
      ctx.lockoutConfig.setDurationMinutes(30);

      for (let i = 0; i < 5; i++) {
        await ctx.authService.login({ username: 'alice', password: 'wrong' }).catch(() => {});
      }

      const status = ctx.lockoutService.checkLockStatus(userId);
      expect(status.locked).toBe(true);
      expect(status.remainingMinutes).toBeLessThanOrEqual(30);
      expect(status.remainingMinutes).toBeGreaterThan(15);
    });

    it('配置为 0 时表示永久锁定', async () => {
      ctx.lockoutConfig.setDurationMinutes(0);

      for (let i = 0; i < 5; i++) {
        await ctx.authService.login({ username: 'alice', password: 'wrong' }).catch(() => {});
      }

      const status = ctx.lockoutService.checkLockStatus(userId);
      expect(status.locked).toBe(true);
      expect(status.permanent).toBe(true);

      ctx.clock.advance(365 * 24 * 60 * 60 * 1000);
      const statusAfterYear = ctx.lockoutService.checkLockStatus(userId);
      expect(statusAfterYear.locked).toBe(true);
      expect(statusAfterYear.permanent).toBe(true);
    });

    it('永久锁定返回永久锁定提示', async () => {
      ctx.lockoutConfig.setDurationMinutes(0);

      for (let i = 0; i < 4; i++) {
        await ctx.authService.login({ username: 'alice', password: 'wrong' }).catch(() => {});
      }

      const error = await ctx.authService.login({ username: 'alice', password: 'wrong' }).catch((e) => e);

      expect(error.code).toBe('ACCOUNT_LOCKED_PERMANENT');
      expect(error.statusCode).toBe(403);
      expect(error.message).toBe(ErrorMessages.ACCOUNT_LOCKED_PERMANENT);
    });
  });

  describe('AC-016: 多次锁定周期独立计算', () => {
    it('锁定到期后再失败达阈值重新锁定，时长不叠加', async () => {
      const lockDurationMs = 15 * 60 * 1000;

      for (let i = 0; i < 5; i++) {
        await ctx.authService.login({ username: 'alice', password: 'wrong' }).catch(() => {});
      }
      expect(ctx.lockoutService.checkLockStatus(userId).locked).toBe(true);

      ctx.clock.advance(lockDurationMs + 1);
      expect(ctx.lockoutService.checkLockStatus(userId).locked).toBe(false);

      for (let i = 0; i < 5; i++) {
        await ctx.authService.login({ username: 'alice', password: 'wrong' }).catch(() => {});
      }

      const status = ctx.lockoutService.checkLockStatus(userId);
      expect(status.locked).toBe(true);
      expect(status.remainingMinutes).toBeLessThanOrEqual(15);
    });
  });

  describe('recordFailure 返回锁定结果', () => {
    it('未达阈值时返回 locked=false', () => {
      const result = ctx.lockoutService.recordFailure(userId);
      expect(result.locked).toBe(false);
      expect(result.failedAttempts).toBe(1);
      expect(result.threshold).toBe(5);
    });

    it('达阈值时返回 locked=true 和剩余分钟数', () => {
      for (let i = 0; i < 4; i++) {
        ctx.lockoutService.recordFailure(userId);
      }
      const result = ctx.lockoutService.recordFailure(userId);
      expect(result.locked).toBe(true);
      expect(result.failedAttempts).toBe(5);
      expect(result.remainingMinutes).toBeGreaterThan(0);
    });

    it('永久锁定时返回 permanent=true', () => {
      ctx.lockoutConfig.setDurationMinutes(0);
      for (let i = 0; i < 4; i++) {
        ctx.lockoutService.recordFailure(userId);
      }
      const result = ctx.lockoutService.recordFailure(userId);
      expect(result.locked).toBe(true);
      expect(result.permanent).toBe(true);
    });
  });
});
