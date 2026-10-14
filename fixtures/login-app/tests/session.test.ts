import { describe, it, expect, beforeEach } from 'vitest';
import { createTestContext, seedUser, type TestContext } from './helpers/test-setup.js';
import { ErrorMessages } from '../src/utils/error-messages.js';
import { AuditEventType } from '../src/models/audit-log-entry.js';

describe('FR-007: 登录会话与凭证管理', () => {
  let ctx: TestContext;
  let userId: string;

  beforeEach(async () => {
    ctx = createTestContext({ costFactor: 4, sessionTTLSeconds: 3600 });
    const user = await seedUser(ctx, { username: 'alice', password: 'P@ssw0rd123', roles: ['user'] });
    userId = user.id;
  });

  describe('AC-024: 凭证在过期时间之前有效', () => {
    it('登录成功后返回的凭证携带后续请求可通过认证', async () => {
      const result = await ctx.authService.login({
        username: 'alice',
        password: 'P@ssw0rd123',
      });

      const payload = ctx.sessionService.verify(result.token);
      expect(payload.sub).toBe(userId);
      expect(payload.exp).toBeGreaterThan(payload.iat);
      expect(payload.roles).toContain('user');
    });

    it('凭证在过期时间之前有效', async () => {
      const result = await ctx.authService.login({
        username: 'alice',
        password: 'P@ssw0rd123',
      });

      ctx.clock.advance(3599 * 1000);

      const payload = ctx.sessionService.verify(result.token);
      expect(payload.sub).toBe(userId);
    });

    it('返回的 expiresIn 和 expiresAt 正确', async () => {
      const result = await ctx.authService.login({
        username: 'alice',
        password: 'P@ssw0rd123',
      });

      expect(result.expiresIn).toBe(3600);
      expect(result.expiresAt).toBe(ctx.clock.now() + 3600 * 1000);
    });
  });

  describe('AC-025: 凭证过期失效', () => {
    it('凭证超过过期时间后失效，返回"登录已过期，请重新登录"', async () => {
      const result = await ctx.authService.login({
        username: 'alice',
        password: 'P@ssw0rd123',
      });

      ctx.clock.advance(3600 * 1000 + 1);

      expect(() => ctx.sessionService.verify(result.token)).toThrow();
      try {
        ctx.sessionService.verify(result.token);
      } catch (err: any) {
        expect(err.code).toBe('TOKEN_EXPIRED');
        expect(err.message).toBe(ErrorMessages.TOKEN_EXPIRED);
        expect(err.statusCode).toBe(401);
      }
    });

    it('过期凭证的后续请求返回 401', async () => {
      const result = await ctx.authService.login({
        username: 'alice',
        password: 'P@ssw0rd123',
      });

      ctx.clock.advance(3600 * 1000 + 1);

      expect(() => ctx.sessionService.verify(result.token)).toThrow();
    });
  });

  describe('AC-026: 主动登出使凭证失效', () => {
    it('用户主动调用登出，凭证立即失效', async () => {
      const result = await ctx.authService.login({
        username: 'alice',
        password: 'P@ssw0rd123',
      });

      const payload = ctx.sessionService.verify(result.token);
      expect(payload.sub).toBe(userId);

      ctx.sessionService.revoke(payload.jti, userId);

      expect(() => ctx.sessionService.verify(result.token)).toThrow();
      try {
        ctx.sessionService.verify(result.token);
      } catch (err: any) {
        expect(err.code).toBe('TOKEN_REVOKED');
        expect(err.message).toBe(ErrorMessages.TOKEN_REVOKED);
      }
    });

    it('登出后后续使用该凭证的请求被拒绝', async () => {
      const result = await ctx.authService.login({
        username: 'alice',
        password: 'P@ssw0rd123',
      });

      const jti = ctx.sessionService.getTokenJti(result.token)!;
      ctx.sessionService.revoke(jti, userId);

      expect(() => ctx.sessionService.verify(result.token)).toThrow();
    });

    it('登出后审计日志记录 LOGOUT 事件', async () => {
      const result = await ctx.authService.login({
        username: 'alice',
        password: 'P@ssw0rd123',
      });

      const jti = ctx.sessionService.getTokenJti(result.token)!;
      ctx.sessionService.revoke(jti, userId);

      const logoutLogs = ctx.auditService.getEntriesByType(AuditEventType.LOGOUT);
      expect(logoutLogs.length).toBe(1);
      expect(logoutLogs[0].userId).toBe(userId);
    });
  });

  describe('AC-027: 多设备并发登录策略', () => {
    it('ALLOW_MULTI 策略：允许多 Token 同时有效', async () => {
      ctx.sessionConfig.setSessionPolicy('ALLOW_MULTI');

      const result1 = await ctx.authService.login({ username: 'alice', password: 'P@ssw0rd123' });
      const result2 = await ctx.authService.login({ username: 'alice', password: 'P@ssw0rd123' });

      expect(result1.token).not.toBe(result2.token);

      const payload1 = ctx.sessionService.verify(result1.token);
      const payload2 = ctx.sessionService.verify(result2.token);

      expect(payload1.sub).toBe(userId);
      expect(payload2.sub).toBe(userId);
      expect(payload1.jti).not.toBe(payload2.jti);
    });

    it('SINGLE_SESSION 策略：新登录吊销旧 Token', async () => {
      ctx.sessionConfig.setSessionPolicy('SINGLE_SESSION');

      const result1 = await ctx.authService.login({ username: 'alice', password: 'P@ssw0rd123' });

      const payload1 = ctx.sessionService.verify(result1.token);
      expect(payload1.sub).toBe(userId);

      const result2 = await ctx.authService.login({ username: 'alice', password: 'P@ssw0rd123' });

      expect(() => ctx.sessionService.verify(result1.token)).toThrow();

      const payload2 = ctx.sessionService.verify(result2.token);
      expect(payload2.sub).toBe(userId);
      expect(payload2.jti).not.toBe(payload1.jti);
    });

    it('策略可动态切换', async () => {
      ctx.sessionConfig.setSessionPolicy('ALLOW_MULTI');
      const result1 = await ctx.authService.login({ username: 'alice', password: 'P@ssw0rd123' });
      const result2 = await ctx.authService.login({ username: 'alice', password: 'P@ssw0rd123' });

      ctx.sessionService.verify(result1.token);
      ctx.sessionService.verify(result2.token);

      ctx.sessionConfig.setSessionPolicy('SINGLE_SESSION');
      const result3 = await ctx.authService.login({ username: 'alice', password: 'P@ssw0rd123' });

      expect(() => ctx.sessionService.verify(result2.token)).toThrow();
      ctx.sessionService.verify(result3.token);
    });
  });
});
