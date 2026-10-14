import { describe, it, expect, beforeEach } from 'vitest';
import { createTestContext, seedUser, type TestContext } from './helpers/test-setup.js';
import { AppError } from '../src/utils/app-error.js';
import { ErrorMessages } from '../src/utils/error-messages.js';
import { validateLoginInput } from '../src/schemas/login-schema.js';

describe('FR-001: 账号密码登录', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = createTestContext({ costFactor: 4 });
    await seedUser(ctx, { username: 'alice', password: 'P@ssw0rd123' });
  });

  describe('AC-001: 正确凭据登录成功', () => {
    it('输入已注册且启用的用户名和正确密码，登录成功，返回有效 Token', async () => {
      const result = await ctx.authService.login({
        username: 'alice',
        password: 'P@ssw0rd123',
        ip: '127.0.0.1',
      });

      expect(result.token).toBeDefined();
      expect(typeof result.token).toBe('string');
      expect(result.token.length).toBeGreaterThan(0);
      expect(result.expiresIn).toBeGreaterThan(0);
      expect(result.expiresAt).toBeGreaterThan(ctx.clock.now());
      expect(result.user.id).toBeDefined();
      expect(result.user.username).toBe('alice');
    });

    it('Token 包含用户标识与过期时间', async () => {
      const result = await ctx.authService.login({
        username: 'alice',
        password: 'P@ssw0rd123',
      });

      const payload = ctx.sessionService.verify(result.token);
      expect(payload.sub).toBe(result.user.id);
      expect(payload.exp).toBeGreaterThan(payload.iat);
      expect(payload.jti).toBeDefined();
    });
  });

  describe('AC-002: 不存在的用户名', () => {
    it('输入不存在的用户名，返回统一错误提示，不泄露用户名是否存在', async () => {
      await expect(
        ctx.authService.login({ username: 'ghost', password: 'anything' }),
      ).rejects.toMatchObject({
        code: 'INVALID_CREDENTIALS',
        statusCode: 401,
        message: ErrorMessages.INVALID_CREDENTIALS,
      });
    });

    it('不存在的用户与密码错误的用户返回相同的错误提示', async () => {
      const nonExistentError = await ctx.authService.login({ username: 'ghost', password: 'test' }).catch((e) => e);
      const wrongPasswordError = await ctx.authService.login({ username: 'alice', password: 'wrongpassword' }).catch((e) => e);

      expect(nonExistentError.code).toBe(wrongPasswordError.code);
      expect(nonExistentError.message).toBe(wrongPasswordError.message);
    });
  });

  describe('AC-003: 禁用账号', () => {
    it('输入已注册但禁用的用户名，返回"账号已被禁用"', async () => {
      await seedUser(ctx, { username: 'bob', password: 'P@ssw0rd123', status: 'disabled' });

      await expect(
        ctx.authService.login({ username: 'bob', password: 'P@ssw0rd123' }),
      ).rejects.toMatchObject({
        code: 'ACCOUNT_DISABLED',
        statusCode: 403,
        message: ErrorMessages.ACCOUNT_DISABLED,
      });
    });
  });

  describe('AC-004: 参数为空', () => {
    it('用户名和密码字段为空，返回"用户名和密码不能为空"', () => {
      const result = validateLoginInput({ username: '', password: '' });
      expect(result.success).toBe(false);
      expect(result.success ? '' : result.error).toBe(ErrorMessages.VALIDATION_ERROR);
    });

    it('用户名为空时校验失败', () => {
      const result = validateLoginInput({ username: '', password: 'test' });
      expect(result.success).toBe(false);
    });

    it('密码为空时校验失败', () => {
      const result = validateLoginInput({ username: 'test', password: '' });
      expect(result.success).toBe(false);
    });

    it('请求体缺失字段时校验失败', () => {
      const result = validateLoginInput({});
      expect(result.success).toBe(false);
    });

    it('有效输入通过校验', () => {
      const result = validateLoginInput({ username: 'alice', password: 'P@ssw0rd123' });
      expect(result.success).toBe(true);
    });
  });

  describe('AC-005: 大小写策略', () => {
    it('区分大小写时，大小写不一致导致登录失败', async () => {
      ctx.authConfig.setCaseSensitive(true);

      await expect(
        ctx.authService.login({ username: 'Alice', password: 'P@ssw0rd123' }),
      ).rejects.toMatchObject({
        code: 'INVALID_CREDENTIALS',
      });
    });

    it('不区分大小写时，大小写不一致仍能登录成功', async () => {
      ctx.authConfig.setCaseSensitive(false);

      const result = await ctx.authService.login({
        username: 'ALICE',
        password: 'P@ssw0rd123',
      });

      expect(result.user.username).toBe('alice');
    });
  });
});
