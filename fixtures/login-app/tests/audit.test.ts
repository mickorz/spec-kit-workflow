import { describe, it, expect, beforeEach } from 'vitest';
import { createTestContext, seedUser, type TestContext } from './helpers/test-setup.js';
import { AuditEventType } from '../src/models/audit-log-entry.js';

describe('NFR-004: 审计日志', () => {
  let ctx: TestContext;
  let userId: string;

  beforeEach(async () => {
    ctx = createTestContext({ costFactor: 4, lockoutThreshold: 5, lockoutDurationMinutes: 15 });
    const user = await seedUser(ctx, { username: 'alice', password: 'P@ssw0rd123' });
    userId = user.id;
  });

  describe('登录成功日志', () => {
    it('登录成功时记录 LOGIN_SUCCESS 事件', async () => {
      await ctx.authService.login({
        username: 'alice',
        password: 'P@ssw0rd123',
        ip: '192.168.1.1',
      });

      const logs = ctx.auditService.getEntriesByType(AuditEventType.LOGIN_SUCCESS);
      expect(logs.length).toBe(1);
      expect(logs[0].userId).toBe(userId);
      expect(logs[0].ip).toBe('192.168.1.1');
      expect(logs[0].result).toBe('success');
      expect(logs[0].ts).toBe(ctx.clock.now());
    });
  });

  describe('登录失败日志', () => {
    it('登录失败时记录 LOGIN_FAILED 事件，含失败次数', async () => {
      await ctx.authService.login({ username: 'alice', password: 'wrong' }).catch(() => {});

      const logs = ctx.auditService.getEntriesByType(AuditEventType.LOGIN_FAILED);
      expect(logs.length).toBe(1);
      expect(logs[0].userId).toBe(userId);
      expect(logs[0].result).toBe('failed');
      expect(logs[0].meta).toBeDefined();
      expect(logs[0].meta!.failedAttempts).toBe(1);
    });

    it('用户不存在时记录 LOGIN_FAILED 事件', async () => {
      await ctx.authService.login({ username: 'nobody', password: 'test' }).catch(() => {});

      const logs = ctx.auditService.getEntriesByType(AuditEventType.LOGIN_FAILED);
      expect(logs.length).toBe(1);
      expect(logs[0].userId).toBeUndefined();
      expect(logs[0].meta).toBeDefined();
      expect(logs[0].meta!.reason).toBe('user_not_found');
    });

    it('失败日志不含密码或哈希信息', async () => {
      await ctx.authService.login({ username: 'alice', password: 'secretPassword123' }).catch(() => {});

      const logs = ctx.auditService.getEntriesByType(AuditEventType.LOGIN_FAILED);
      const logStr = JSON.stringify(logs[0]);
      expect(logStr).not.toContain('secretPassword123');
      expect(logStr).not.toContain('password');
      expect(logStr).not.toContain('hash');
    });
  });

  describe('锁定触发日志', () => {
    it('账号锁定触发时记录 LOCK_TRIGGERED 事件', async () => {
      for (let i = 0; i < 5; i++) {
        await ctx.authService.login({ username: 'alice', password: 'wrong', ip: '10.0.0.1' }).catch(() => {});
      }

      const logs = ctx.auditService.getEntriesByType(AuditEventType.LOCK_TRIGGERED);
      expect(logs.length).toBe(1);
      expect(logs[0].userId).toBe(userId);
      expect(logs[0].ip).toBe('10.0.0.1');
      expect(logs[0].result).toBe('success');
      expect(logs[0].meta).toBeDefined();
      expect(logs[0].meta!.failedAttempts).toBe(5);
      expect(logs[0].meta!.threshold).toBe(5);
    });

    it('多次锁定触发多次 LOCK_TRIGGERED 事件', async () => {
      for (let i = 0; i < 5; i++) {
        await ctx.authService.login({ username: 'alice', password: 'wrong' }).catch(() => {});
      }

      ctx.clock.advance(15 * 60 * 1000 + 1);
      ctx.lockoutService.checkLockStatus(userId);

      for (let i = 0; i < 5; i++) {
        await ctx.authService.login({ username: 'alice', password: 'wrong' }).catch(() => {});
      }

      const logs = ctx.auditService.getEntriesByType(AuditEventType.LOCK_TRIGGERED);
      expect(logs.length).toBe(2);
    });
  });

  describe('自动解锁日志', () => {
    it('锁定到期自动解锁时记录 AUTO_UNLOCK 事件', () => {
      ctx.lockoutService.setLockState(userId, {
        lockedAt: ctx.clock.now(),
        lockDurationMs: 15 * 60 * 1000,
        failedAttempts: 5,
      });

      ctx.clock.advance(15 * 60 * 1000 + 1);

      ctx.lockoutService.checkLockStatus(userId);

      const logs = ctx.auditService.getEntriesByType(AuditEventType.AUTO_UNLOCK);
      expect(logs.length).toBe(1);
      expect(logs[0].userId).toBe(userId);
      expect(logs[0].result).toBe('success');
    });
  });

  describe('管理员手动解锁日志', () => {
    it('管理员解锁时记录 ADMIN_UNLOCK 事件', () => {
      ctx.lockoutService.setLockState(userId, {
        lockedAt: ctx.clock.now(),
        lockDurationMs: 15 * 60 * 1000,
        failedAttempts: 5,
      });

      ctx.lockoutService.adminUnlock(userId);

      const logs = ctx.auditService.getEntriesByType(AuditEventType.ADMIN_UNLOCK);
      expect(logs.length).toBe(1);
      expect(logs[0].userId).toBe(userId);
      expect(logs[0].result).toBe('success');
    });
  });

  describe('登出日志', () => {
    it('登出时记录 LOGOUT 事件', async () => {
      const result = await ctx.authService.login({
        username: 'alice',
        password: 'P@ssw0rd123',
      });

      const jti = ctx.sessionService.getTokenJti(result.token)!;
      ctx.sessionService.revoke(jti, userId);

      const logs = ctx.auditService.getEntriesByType(AuditEventType.LOGOUT);
      expect(logs.length).toBe(1);
      expect(logs[0].userId).toBe(userId);
      expect(logs[0].result).toBe('success');
    });
  });

  describe('日志格式与完整性', () => {
    it('日志条目包含时间戳、账号标识、事件类型与结果', async () => {
      await ctx.authService.login({ username: 'alice', password: 'P@ssw0rd123', ip: '10.0.0.1' });

      const entries = ctx.auditService.getEntries();
      expect(entries.length).toBeGreaterThan(0);

      const entry = entries[0];
      expect(entry.ts).toBeDefined();
      expect(typeof entry.ts).toBe('number');
      expect(entry.eventType).toBeDefined();
      expect(entry.userId).toBe(userId);
      expect(entry.ip).toBe('10.0.0.1');
      expect(entry.result).toBe('success');
    });

    it('日志按用户查询', async () => {
      await ctx.authService.login({ username: 'alice', password: 'P@ssw0rd123' });
      await ctx.authService.login({ username: 'alice', password: 'wrong' }).catch(() => {});

      const userLogs = ctx.auditService.getEntriesByUser(userId);
      expect(userLogs.length).toBe(2);
      expect(userLogs[0].userId).toBe(userId);
      expect(userLogs[1].userId).toBe(userId);
    });
  });

  describe('日志防篡改', () => {
    it('getEntries 返回不可变副本，修改不影响内部数据', async () => {
      await ctx.authService.login({ username: 'alice', password: 'P@ssw0rd123' });

      const entries = ctx.auditService.getEntries();
      expect(entries.length).toBe(1);

      expect(() => {
        (entries[0] as any).result = 'tampered';
      }).toThrow();

      const fresh = ctx.auditService.getEntries();
      expect(fresh[0].result).toBe('success');
    });

    it('getEntriesByType 返回不可变副本', async () => {
      await ctx.authService.login({ username: 'alice', password: 'P@ssw0rd123' });

      const logs = ctx.auditService.getEntriesByType(AuditEventType.LOGIN_SUCCESS);
      expect(() => {
        (logs[0] as any).result = 'tampered';
      }).toThrow();

      const fresh = ctx.auditService.getEntriesByType(AuditEventType.LOGIN_SUCCESS);
      expect(fresh[0].result).toBe('success');
    });

    it('日志条目数量不受外部修改影响', async () => {
      await ctx.authService.login({ username: 'alice', password: 'P@ssw0rd123' });

      const entries = ctx.auditService.getEntries();
      expect(entries.length).toBe(1);

      try {
        entries.push({} as any);
      } catch {
        // frozen array push throws
      }

      expect(ctx.auditService.count()).toBe(1);
    });
  });

  describe('日志保留策略', () => {
    it('默认保留期限为 90 天', () => {
      expect(ctx.auditService.getRetentionDays()).toBe(90);
    });

    it('保留期限内日志不过期', async () => {
      await ctx.authService.login({ username: 'alice', password: 'P@ssw0rd123' });

      ctx.clock.advance(89 * 24 * 60 * 60 * 1000);

      const expired = ctx.auditService.getExpiredEntries();
      expect(expired.length).toBe(0);
    });

    it('超过保留期限的日志过期', async () => {
      await ctx.authService.login({ username: 'alice', password: 'P@ssw0rd123' });

      ctx.clock.advance(91 * 24 * 60 * 60 * 1000);

      const expired = ctx.auditService.getExpiredEntries();
      expect(expired.length).toBe(1);
    });

    it('pruneExpired 清理过期日志并返回清理数量', async () => {
      await ctx.authService.login({ username: 'alice', password: 'P@ssw0rd123' });

      ctx.clock.advance(91 * 24 * 60 * 60 * 1000);

      const pruned = ctx.auditService.pruneExpired();
      expect(pruned).toBe(1);
      expect(ctx.auditService.count()).toBe(0);
    });

    it('保留期限内 pruneExpired 不清理', async () => {
      await ctx.authService.login({ username: 'alice', password: 'P@ssw0rd123' });

      ctx.clock.advance(30 * 24 * 60 * 60 * 1000);

      const pruned = ctx.auditService.pruneExpired();
      expect(pruned).toBe(0);
      expect(ctx.auditService.count()).toBe(1);
    });
  });
});
