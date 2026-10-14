import { describe, it, expect, beforeEach } from 'vitest';
import { createTestContext, seedUser, type TestContext } from './helpers/test-setup.js';
import { ErrorMessages } from '../src/utils/error-messages.js';
import { validateLoginInput } from '../src/schemas/login-schema.js';

describe('NFR-005: 错误提示安全性', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = createTestContext({ costFactor: 4 });
    await seedUser(ctx, { username: 'alice', password: 'P@ssw0rd123' });
  });

  describe('错误提示不泄露内部信息', () => {
    it('用户不存在时不泄露用户名是否存在', async () => {
      const error = await ctx.authService.login({ username: 'ghost', password: 'test' }).catch((e) => e);

      expect(error.message).toBe(ErrorMessages.INVALID_CREDENTIALS);
      expect(error.message).not.toContain('用户不存在');
      expect(error.message).not.toContain('not found');
      expect(error.message).not.toContain('no such user');
    });

    it('密码错误时不返回密码格式校验细节', async () => {
      const error = await ctx.authService.login({ username: 'alice', password: 'x' }).catch((e) => e);

      expect(error.message).toBe(ErrorMessages.INVALID_CREDENTIALS);
      expect(error.message).not.toContain('格式');
      expect(error.message).not.toContain('长度');
      expect(error.message).not.toContain('format');
      expect(error.message).not.toContain('length');
    });

    it('密码错误时不返回哈希算法信息', async () => {
      const error = await ctx.authService.login({ username: 'alice', password: 'wrong' }).catch((e) => e);

      expect(error.message).not.toContain('bcrypt');
      expect(error.message).not.toContain('hash');
      expect(error.message).not.toContain('salt');
      expect(error.message).not.toContain('argon');
    });

    it('错误响应统一为业务级提示', async () => {
      const testCases = [
        { username: 'ghost', password: 'test' },
        { username: 'alice', password: 'wrong' },
      ];

      for (const tc of testCases) {
        const error = await ctx.authService.login(tc).catch((e) => e);
        expect(error.code).toBe('INVALID_CREDENTIALS');
        expect(error.statusCode).toBe(401);
        expect(error.message).toBe(ErrorMessages.INVALID_CREDENTIALS);
      }
    });
  });

  describe('参数校验提示安全性', () => {
    it('空字段提交返回校验提示，不泄露其他信息', () => {
      const result = validateLoginInput({ username: '', password: '' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe(ErrorMessages.VALIDATION_ERROR);
        expect(result.error).not.toContain('required');
        expect(result.error).not.toContain('min');
      }
    });
  });

  describe('禁用账号提示', () => {
    it('禁用账号返回明确提示，不泄露其他信息', async () => {
      await seedUser(ctx, { username: 'bob', password: 'P@ssw0rd123', status: 'disabled' });

      const error = await ctx.authService.login({ username: 'bob', password: 'P@ssw0rd123' }).catch((e) => e);

      expect(error.code).toBe('ACCOUNT_DISABLED');
      expect(error.message).toBe(ErrorMessages.ACCOUNT_DISABLED);
      expect(error.message).not.toContain('hash');
      expect(error.message).not.toContain('password');
    });
  });

  describe('审计日志可记录技术细节但不暴露给用户', () => {
    it('审计日志 meta 不含明文密码', async () => {
      await ctx.authService.login({ username: 'alice', password: 'SecretPass123' }).catch(() => {});

      const entries = ctx.auditService.getEntries();
      const logStr = JSON.stringify(entries);
      expect(logStr).not.toContain('SecretPass123');
    });

    it('审计日志 meta 不含哈希值', async () => {
      await ctx.authService.login({ username: 'alice', password: 'wrong' }).catch(() => {});

      const entries = ctx.auditService.getEntries();
      const logStr = JSON.stringify(entries);
      expect(logStr).not.toContain('$2');
      expect(logStr).not.toContain('bcrypt');
    });
  });

  describe('错误码与消息映射', () => {
    it('所有对外错误消息均为业务级提示', () => {
      const sensitiveKeywords = ['sql', 'database', 'stack', 'trace', 'internal', 'exception', 'query'];
      const allMessages = Object.values(ErrorMessages);

      for (const msg of allMessages) {
        const lowerMsg = String(msg).toLowerCase();
        for (const keyword of sensitiveKeywords) {
          expect(lowerMsg).not.toContain(keyword);
        }
      }
    });
  });
});
