import { describe, it, expect, beforeEach } from 'vitest';
import { createTestContext, seedUser, type TestContext } from './helpers/test-setup.js';
import { ErrorMessages } from '../src/utils/error-messages.js';
import { AuditEventType } from '../src/models/audit-log-entry.js';
import { requireRole } from '../src/middleware/auth-middleware.js';

function createMockRes(): any {
  const res: any = {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(data: any) {
      res.body = data;
      return res;
    },
  };
  return res;
}

function createMockNext(res: any): any {
  return (err?: any) => {
    if (err) {
      res.statusCode = err.statusCode || 500;
      res.body = { error: { code: err.code || 'INTERNAL_ERROR', message: err.message } };
    }
  };
}

describe('FR-005: 管理员手动解锁', () => {
  let ctx: TestContext;
  let userId: string;

  beforeEach(async () => {
    ctx = createTestContext({ costFactor: 4 });
    const user = await seedUser(ctx, { username: 'alice', password: 'P@ssw0rd123', roles: [] });
    userId = user.id;
  });

  describe('AC-017: 管理员解锁已锁定账号', () => {
    it('管理员调用解锁接口传入已锁定的有效账号，立即清除锁定并重置失败计数', () => {
      ctx.lockoutService.setLockState(userId, {
        lockedAt: ctx.clock.now(),
        lockDurationMs: 15 * 60 * 1000,
        failedAttempts: 5,
      });

      expect(ctx.lockoutService.checkLockStatus(userId).locked).toBe(true);

      ctx.lockoutService.adminUnlock(userId);

      const status = ctx.lockoutService.checkLockStatus(userId);
      expect(status.locked).toBe(false);
      expect(ctx.lockoutService.getFailedAttempts(userId)).toBe(0);

      const unlockLogs = ctx.auditService.getEntriesByType(AuditEventType.ADMIN_UNLOCK);
      expect(unlockLogs.length).toBe(1);
      expect(unlockLogs[0].userId).toBe(userId);
      expect(unlockLogs[0].result).toBe('success');
    });

    it('解锁后账号恢复可登录', async () => {
      ctx.lockoutService.setLockState(userId, {
        lockedAt: ctx.clock.now(),
        lockDurationMs: 0,
        permanent: true,
        failedAttempts: 5,
      });

      ctx.lockoutService.adminUnlock(userId);

      const result = await ctx.authService.login({
        username: 'alice',
        password: 'P@ssw0rd123',
      });
      expect(result.token).toBeDefined();
    });
  });

  describe('AC-018: 解锁不存在的账号', () => {
    it('管理员调用解锁接口传入不存在的账号标识，返回"账号不存在"错误', async () => {
      const { createAdminUnlockHandler } = await import('../src/handlers/admin-unlock.js');
      const handler = createAdminUnlockHandler(ctx.lockoutService, ctx.userRepo);

      const req = { params: { userId: 'non-existent-id' } } as any;
      const res = createMockRes();
      const next = createMockNext(res);

      await handler(req, res, next);

      expect(res.statusCode).toBe(404);
      expect(res.body.error.code).toBe('ACCOUNT_NOT_FOUND');
      expect(res.body.error.message).toBe(ErrorMessages.ACCOUNT_NOT_FOUND);
    });

    it('不产生副作用', () => {
      ctx.lockoutService.adminUnlock('non-existent-id');

      expect(ctx.lockoutService.getFailedAttempts('non-existent-id')).toBe(0);
    });
  });

  describe('AC-019: 解锁未锁定账号（幂等）', () => {
    it('对未锁定账号调用解锁接口，操作幂等成功，不报错', () => {
      expect(() => {
        ctx.lockoutService.adminUnlock(userId);
      }).not.toThrow();

      const status = ctx.lockoutService.checkLockStatus(userId);
      expect(status.locked).toBe(false);
      expect(ctx.lockoutService.getFailedAttempts(userId)).toBe(0);
    });

    it('多次调用解锁接口结果一致', () => {
      ctx.lockoutService.adminUnlock(userId);
      ctx.lockoutService.adminUnlock(userId);
      ctx.lockoutService.adminUnlock(userId);

      expect(ctx.lockoutService.getFailedAttempts(userId)).toBe(0);
      const status = ctx.lockoutService.checkLockStatus(userId);
      expect(status.locked).toBe(false);

      const unlockLogs = ctx.auditService.getEntriesByType(AuditEventType.ADMIN_UNLOCK);
      expect(unlockLogs.length).toBe(3);
    });
  });

  describe('AC-020: 非管理员无权限', () => {
    it('非管理员角色调用解锁接口，返回"无权限"错误', () => {
      const middleware = requireRole('admin');

      const req = { user: { sub: 'user1', jti: 'jti1', roles: ['user'] } } as any;
      const res = createMockRes();
      let nextCalled = false;
      const next = () => { nextCalled = true; };

      middleware(req, res, next);

      expect(res.statusCode).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(res.body.error.message).toBe(ErrorMessages.FORBIDDEN);
      expect(nextCalled).toBe(false);
    });

    it('管理员角色通过权限校验', () => {
      const middleware = requireRole('admin');

      const req = { user: { sub: 'admin1', jti: 'jti1', roles: ['admin'] } } as any;
      const res = createMockRes();
      let nextCalled = false;
      const next = () => { nextCalled = true; };

      middleware(req, res, next);

      expect(nextCalled).toBe(true);
    });

    it('无 Token 时拒绝', () => {
      const middleware = requireRole('admin');

      const req = {} as any;
      const res = createMockRes();
      const next = () => {};

      middleware(req, res, next);

      expect(res.statusCode).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });
});
