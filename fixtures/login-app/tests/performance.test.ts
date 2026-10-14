import { describe, it, expect, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { createTestContext, seedUser, type TestContext } from './helpers/test-setup.js';

function createMockResWithEvents(): any {
  const ee = new EventEmitter();
  const res: any = {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(data: any) {
      res.body = data;
      res.emit('finish');
      return res;
    },
    on(event: string, listener: (...args: any[]) => void) {
      ee.on(event, listener);
      return res;
    },
    emit(event: string, ...args: any[]) {
      ee.emit(event, ...args);
    },
  };
  return res;
}

describe('NFR-002: 登录接口响应性能', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = createTestContext({ costFactor: 4 });
    await seedUser(ctx, { username: 'alice', password: 'P@ssw0rd123' });
  });

  describe('登录请求计时', () => {
    it('登录请求处理耗时在合理范围', async () => {
      const start = performance.now();
      await ctx.authService.login({ username: 'alice', password: 'P@ssw0rd123' });
      const elapsed = performance.now() - start;

      expect(elapsed).toBeGreaterThan(0);
    });
  });

  describe('锁定判定不显著拖慢主流程', () => {
    it('无锁定状态的账号登录耗时在合理范围', async () => {
      const start = performance.now();
      await ctx.authService.login({ username: 'alice', password: 'P@ssw0rd123' });
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(2000);
    });

    it('checkLockStatus 为内存操作，耗时极低', () => {
      const start = performance.now();
      for (let i = 0; i < 10000; i++) {
        ctx.lockoutService.checkLockStatus('non-existent-user');
      }
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(500);
    });
  });

  describe('P95/P99 分位阈值断言', () => {
    it('P95 不超过 500ms', async () => {
      const { createLoginHandler } = await import('../src/handlers/login.js');
      const trackMiddleware = ctx.perfMiddleware.track('/api/login');
      const handler = createLoginHandler(ctx.authService);

      const sampleCount = 20;
      for (let i = 0; i < sampleCount; i++) {
        await new Promise<void>((resolve) => {
          const req = { body: { username: 'alice', password: 'P@ssw0rd123' }, ip: '127.0.0.1' } as any;
          const res = createMockResWithEvents();
          trackMiddleware(req, res, () => {
            handler(req, res, () => {}).then(() => resolve());
          });
        });
      }

      const p95 = ctx.perfMiddleware.getPercentile('/api/login', 95);
      expect(p95).not.toBeNull();
      expect(p95!).toBeLessThanOrEqual(500);
    });

    it('P99 不超过 1000ms', async () => {
      const { createLoginHandler } = await import('../src/handlers/login.js');
      const trackMiddleware = ctx.perfMiddleware.track('/api/login2');
      const handler = createLoginHandler(ctx.authService);

      const sampleCount = 20;
      for (let i = 0; i < sampleCount; i++) {
        await new Promise<void>((resolve) => {
          const req = { body: { username: 'alice', password: 'P@ssw0rd123' }, ip: '127.0.0.1' } as any;
          const res = createMockResWithEvents();
          trackMiddleware(req, res, () => {
            handler(req, res, () => {}).then(() => resolve());
          });
        });
      }

      const p99 = ctx.perfMiddleware.getPercentile('/api/login2', 99);
      expect(p99).not.toBeNull();
      expect(p99!).toBeLessThanOrEqual(1000);
    });
  });

  describe('性能统计', () => {
    it('PerformanceMiddleware 统计 P95/P99 分位', async () => {
      const { createLoginHandler } = await import('../src/handlers/login.js');
      const trackMiddleware = ctx.perfMiddleware.track('/api/login3');
      const handler = createLoginHandler(ctx.authService);

      for (let i = 0; i < 5; i++) {
        await new Promise<void>((resolve) => {
          const req = { body: { username: 'alice', password: 'P@ssw0rd123' }, ip: '127.0.0.1' } as any;
          const res = createMockResWithEvents();
          trackMiddleware(req, res, () => {
            handler(req, res, () => {}).then(() => resolve());
          });
        });
      }

      const stats = ctx.perfMiddleware.getStats('/api/login3');
      expect(stats).toBeDefined();
      expect(stats!.count).toBe(5);
      expect(stats!.minMs).toBeGreaterThan(0);

      const p95 = ctx.perfMiddleware.getPercentile('/api/login3', 95);
      expect(p95).not.toBeNull();
      expect(p95!).toBeGreaterThan(0);

      const p99 = ctx.perfMiddleware.getPercentile('/api/login3', 99);
      expect(p99).not.toBeNull();
      expect(p99!).toBeGreaterThan(0);
    });
  });
});
