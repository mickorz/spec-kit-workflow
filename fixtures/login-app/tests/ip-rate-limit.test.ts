import { describe, it, expect, beforeEach } from 'vitest';
import { createTestContext, seedUser, type TestContext } from './helpers/test-setup.js';

describe('NFR-003: 防暴力破解能力', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext({
      costFactor: 4,
      rateLimitMaxFailures: 3,
      rateLimitWindowMinutes: 1,
      rateLimitBanMinutes: 5,
    });
  });

  describe('IP 维度登录失败频率限制', () => {
    it('未超限时 IP 请求正常通过', () => {
      expect(ctx.ipRateLimiter.isAllowed('192.168.1.1')).toBe(true);
    });

    it('同一 IP 失败次数达到阈值后限流', () => {
      const ip = '192.168.1.100';

      for (let i = 0; i < 3; i++) {
        expect(ctx.ipRateLimiter.isAllowed(ip)).toBe(true);
        ctx.ipRateLimiter.recordFailure(ip);
      }

      expect(ctx.ipRateLimiter.isAllowed(ip)).toBe(false);
      expect(ctx.ipRateLimiter.isBanned(ip)).toBe(true);
    });

    it('限流后返回封禁状态', () => {
      const ip = '10.0.0.1';

      for (let i = 0; i < 3; i++) {
        ctx.ipRateLimiter.recordFailure(ip);
      }

      expect(ctx.ipRateLimiter.isBanned(ip)).toBe(true);
      expect(ctx.ipRateLimiter.getRemainingBanMs(ip)).toBeGreaterThan(0);
    });

    it('封禁到期后恢复', () => {
      const ip = '10.0.0.2';

      for (let i = 0; i < 3; i++) {
        ctx.ipRateLimiter.recordFailure(ip);
      }
      expect(ctx.ipRateLimiter.isBanned(ip)).toBe(true);

      ctx.clock.advance(5 * 60 * 1000 + 1);

      expect(ctx.ipRateLimiter.isBanned(ip)).toBe(false);
      expect(ctx.ipRateLimiter.isAllowed(ip)).toBe(true);
    });

    it('不同 IP 互不影响', () => {
      const ip1 = '10.0.0.10';
      const ip2 = '10.0.0.20';

      for (let i = 0; i < 3; i++) {
        ctx.ipRateLimiter.recordFailure(ip1);
      }

      expect(ctx.ipRateLimiter.isBanned(ip1)).toBe(true);
      expect(ctx.ipRateLimiter.isBanned(ip2)).toBe(false);
      expect(ctx.ipRateLimiter.isAllowed(ip2)).toBe(true);
    });

    it('窗口过期后计数重置', () => {
      const ip = '10.0.0.30';

      ctx.ipRateLimiter.recordFailure(ip);
      ctx.ipRateLimiter.recordFailure(ip);

      ctx.clock.advance(61 * 1000);

      expect(ctx.ipRateLimiter.isAllowed(ip)).toBe(true);
    });

    it('限流参数可动态调整', () => {
      const ip = '10.0.0.40';

      for (let i = 0; i < 3; i++) {
        ctx.ipRateLimiter.recordFailure(ip);
      }
      expect(ctx.ipRateLimiter.isBanned(ip)).toBe(true);

      ctx.ipRateLimiter.clear();

      ctx.config.set('rateLimit.maxFailures', 5);

      const ip2 = '10.0.0.50';
      for (let i = 0; i < 4; i++) {
        ctx.ipRateLimiter.recordFailure(ip2);
      }
      expect(ctx.ipRateLimiter.isBanned(ip2)).toBe(false);
      expect(ctx.ipRateLimiter.isAllowed(ip2)).toBe(true);
    });
  });

  describe('单账号维度失败锁定', () => {
    beforeEach(async () => {
      await seedUser(ctx, { username: 'alice', password: 'P@ssw0rd123' });
    });

    it('单账号连续失败达阈值即锁定', async () => {
      for (let i = 0; i < 5; i++) {
        await ctx.authService.login({ username: 'alice', password: 'wrong' }).catch(() => {});
      }

      const userId = (await ctx.userRepo.findByUsername('alice', { caseSensitive: true }))!.id;
      expect(ctx.lockoutService.checkLockStatus(userId).locked).toBe(true);
    });

    it('IP 封禁与账号锁定独立运作', async () => {
      const ip1 = '10.0.0.10';
      for (let i = 0; i < 3; i++) {
        ctx.ipRateLimiter.recordFailure(ip1);
      }
      expect(ctx.ipRateLimiter.isBanned(ip1)).toBe(true);

      expect(ctx.ipRateLimiter.isAllowed('10.0.0.20')).toBe(true);
    });

    it('锁定参数可动态调整不重启服务', async () => {
      ctx.lockoutConfig.setThreshold(3);

      for (let i = 0; i < 2; i++) {
        await ctx.authService.login({ username: 'alice', password: 'wrong' }).catch(() => {});
      }

      const userId = (await ctx.userRepo.findByUsername('alice', { caseSensitive: true }))!.id;
      expect(ctx.lockoutService.checkLockStatus(userId).locked).toBe(false);

      await ctx.authService.login({ username: 'alice', password: 'wrong' }).catch(() => {});
      expect(ctx.lockoutService.checkLockStatus(userId).locked).toBe(true);
    });
  });
});
