import { describe, it, expect, beforeEach } from 'vitest';
import { createTestContext, seedUser, type TestContext } from './helpers/test-setup.js';
import { ErrorMessages } from '../src/utils/error-messages.js';

describe('FR-002: 密码错误处理', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = createTestContext({ costFactor: 4 });
    await seedUser(ctx, { username: 'alice', password: 'P@ssw0rd123' });
  });

  describe('AC-006: 密码错误累计失败次数', () => {
    it('输入错误密码，返回"用户名或密码错误"提示，失败计数 +1', async () => {
      expect(ctx.lockoutService.getFailedAttempts('unknown')).toBe(0);

      const userId = (await ctx.userRepo.findByUsername('alice', { caseSensitive: true }))!.id;

      expect(ctx.lockoutService.getFailedAttempts(userId)).toBe(0);

      await expect(
        ctx.authService.login({ username: 'alice', password: 'wrongpassword' }),
      ).rejects.toMatchObject({
        code: 'INVALID_CREDENTIALS',
        message: ErrorMessages.INVALID_CREDENTIALS,
      });

      expect(ctx.lockoutService.getFailedAttempts(userId)).toBe(1);
    });

    it('多次错误密码，失败计数持续累加', async () => {
      const userId = (await ctx.userRepo.findByUsername('alice', { caseSensitive: true }))!.id;

      for (let i = 1; i <= 3; i++) {
        await expect(
          ctx.authService.login({ username: 'alice', password: `wrong${i}` }),
        ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
        expect(ctx.lockoutService.getFailedAttempts(userId)).toBe(i);
      }
    });
  });

  describe('AC-007: 失败后立即输入正确密码，失败计数清零', () => {
    it('一次失败后立即输入正确密码，登录成功且失败计数清零', async () => {
      const userId = (await ctx.userRepo.findByUsername('alice', { caseSensitive: true }))!.id;

      await expect(
        ctx.authService.login({ username: 'alice', password: 'wrongpassword' }),
      ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });

      expect(ctx.lockoutService.getFailedAttempts(userId)).toBe(1);

      const result = await ctx.authService.login({
        username: 'alice',
        password: 'P@ssw0rd123',
      });

      expect(result.token).toBeDefined();
      expect(ctx.lockoutService.getFailedAttempts(userId)).toBe(0);
    });

    it('多次失败后输入正确密码，失败计数清零', async () => {
      const userId = (await ctx.userRepo.findByUsername('alice', { caseSensitive: true }))!.id;

      for (let i = 0; i < 4; i++) {
        await ctx.authService.login({ username: 'alice', password: 'wrong' }).catch(() => {});
      }
      expect(ctx.lockoutService.getFailedAttempts(userId)).toBe(4);

      await ctx.authService.login({ username: 'alice', password: 'P@ssw0rd123' });
      expect(ctx.lockoutService.getFailedAttempts(userId)).toBe(0);
    });
  });

  describe('AC-008: 错误提示不含技术信息', () => {
    it('密码错误时不返回密码格式或哈希相关信息', async () => {
      const error = await ctx.authService.login({ username: 'alice', password: 'wrong' }).catch((e) => e);

      expect(error.message).toBe(ErrorMessages.INVALID_CREDENTIALS);
      expect(error.message).not.toContain('hash');
      expect(error.message).not.toContain('bcrypt');
      expect(error.message).not.toContain('password hash');
      expect(error.message).not.toContain('格式');
      expect(error.message).not.toContain('盐');
      expect(error.message).not.toContain('salt');
    });

    it('用户不存在时返回与密码错误相同的提示', async () => {
      const notFoundError = await ctx.authService.login({ username: 'nobody', password: 'test' }).catch((e) => e);
      const wrongPwError = await ctx.authService.login({ username: 'alice', password: 'wrong' }).catch((e) => e);

      expect(notFoundError.message).toBe(wrongPwError.message);
      expect(notFoundError.code).toBe(wrongPwError.code);
    });
  });
});
