import { describe, it, expect, beforeEach } from 'vitest';
import { createTestContext, seedUser, seedUserWithHash, type TestContext } from './helpers/test-setup.js';
import { BcryptHasher } from '../src/services/bcrypt-hasher.js';
import { PasswordHasherRegistry } from '../src/services/password-hasher.js';
import type { PasswordHasher } from '../src/services/password-hasher.js';
import { PasswordStorageValidator } from '../src/utils/password-storage-validator.js';
import { PasswordMigrationService } from '../src/services/password-migration.js';
import { InMemoryUserRepository } from '../src/repositories/user-repository.js';
import { FakeClock } from '../src/utils/clock.js';

class WrapperHasher implements PasswordHasher {
  constructor(
    private inner: PasswordHasher,
    private algoName: string,
  ) {}

  hash(plain: string): Promise<string> {
    return this.inner.hash(plain);
  }

  verify(plain: string, hash: string): Promise<boolean> {
    return this.inner.verify(plain, hash);
  }

  getAlgorithm(): string {
    return this.algoName;
  }
}

describe('FR-006 + NFR-001: 密码安全存储与校验', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext({ costFactor: 4 });
  });

  describe('AC-021: 哈希存储不含明文，相同明文不同盐值产生不同哈希', () => {
    it('数据库中存储的密码字段为哈希值，不含明文', async () => {
      const plainPassword = 'MySecret123';
      const hash = await ctx.hasher.hash(plainPassword);

      expect(hash).not.toBe(plainPassword);
      expect(hash.length).toBeGreaterThan(plainPassword.length);
      expect(hash).not.toContain(plainPassword);
      expect(hash.startsWith('$2')).toBe(true);
    });

    it('相同明文密码因不同盐值产生不同哈希', async () => {
      const plainPassword = 'SamePassword123';
      const hash1 = await ctx.hasher.hash(plainPassword);
      const hash2 = await ctx.hasher.hash(plainPassword);

      expect(hash1).not.toBe(hash2);
      expect(hash1.startsWith('$2')).toBe(true);
      expect(hash2.startsWith('$2')).toBe(true);
    });

    it('PasswordStorageValidator 验证哈希格式', async () => {
      const validHash = await ctx.hasher.hash('test123');

      expect(PasswordStorageValidator.validate(validHash).valid).toBe(true);
      expect(PasswordStorageValidator.validate('plaintext').valid).toBe(false);
      expect(PasswordStorageValidator.validate('5d41402abc4b2a76b9719d911017c592').valid).toBe(false);
    });
  });

  describe('AC-022: 登录校验哈希比对', () => {
    it('输入密码经哈希处理后与存储哈希比对一致即视为密码正确', async () => {
      const plainPassword = 'CorrectPassword123';
      const hash = await ctx.hasher.hash(plainPassword);

      const result = await ctx.hasher.verify(plainPassword, hash);
      expect(result).toBe(true);
    });

    it('错误密码哈希比对不一致', async () => {
      const hash = await ctx.hasher.hash('CorrectPassword123');

      const result = await ctx.hasher.verify('WrongPassword456', hash);
      expect(result).toBe(false);
    });

    it('同一密码多次验证结果一致', async () => {
      const hash = await ctx.hasher.hash('StablePassword123');

      for (let i = 0; i < 3; i++) {
        const result = await ctx.hasher.verify('StablePassword123', hash);
        expect(result).toBe(true);
      }
    });
  });

  describe('AC-023: 哈希算法可配置替换 + 迁移', () => {
    it('PasswordHasherRegistry 支持注册多种算法', () => {
      const registry = new PasswordHasherRegistry('bcrypt');
      const bcryptHasher = new BcryptHasher(4);
      registry.register('bcrypt', bcryptHasher);

      expect(registry.has('bcrypt')).toBe(true);
      expect(registry.getDefault().getAlgorithm()).toBe('bcrypt');
    });

    it('切换默认算法后使用新算法', () => {
      const registry = new PasswordHasherRegistry('bcrypt');
      const hasher1 = new BcryptHasher(4);
      const hasher2 = new BcryptHasher(4);
      registry.register('bcrypt', hasher1);
      registry.register('bcrypt-v2', hasher2);

      expect(registry.get('bcrypt').getAlgorithm()).toBe('bcrypt');
      expect(registry.get('bcrypt-v2').getAlgorithm()).toBe('bcrypt');

      registry.setDefaultAlgorithm('bcrypt-v2');
      expect(registry.getDefaultAlgorithm()).toBe('bcrypt-v2');
    });

    it('通过哈希前缀自动检测算法', async () => {
      const hash = await ctx.hasher.hash('test123');
      const detected = ctx.hasherRegistry.detectAlgorithm(hash);

      expect(detected).toBe('bcrypt');
    });

    it('检测未知格式返回 null', () => {
      expect(ctx.hasherRegistry.detectAlgorithm('plaintext')).toBe(null);
      expect(ctx.hasherRegistry.detectAlgorithm('5d41402abc4b2a76b9719d911017c592')).toBe(null);
    });

    it('迁移服务在算法一致时不迁移', async () => {
      const user = await seedUserWithHash(ctx, {
        username: 'alice',
        passwordHash: await ctx.hasher.hash('P@ssw0rd123'),
      });

      const result = await ctx.migrationService.migrateIfNeeded(
        user.id,
        'P@ssw0rd123',
        user.passwordHash,
      );

      expect(result.migrated).toBe(false);
    });

    it('从旧算法迁移到新算法的完整路径', async () => {
      const oldHasher = new BcryptHasher(4);
      const newHasher = new WrapperHasher(new BcryptHasher(4), 'bcrypt-v2');

      const registry = new PasswordHasherRegistry('bcrypt-v2');
      registry.register('bcrypt', oldHasher);
      registry.register('bcrypt-v2', newHasher);

      const userRepo = new InMemoryUserRepository();
      const clock = new FakeClock(1_000_000_000_000);
      const migrationService = new PasswordMigrationService(registry, userRepo);

      const plainPassword = 'MigrateMe123';
      const oldHash = await oldHasher.hash(plainPassword);

      const user = {
        id: 'user-migrate-1',
        username: 'migrator',
        email: 'migrator@test.com',
        passwordHash: oldHash,
        status: 'enabled' as const,
        roles: [],
        createdAt: clock.now(),
      };
      await userRepo.save(user);

      const oldHashValue = user.passwordHash;

      const result = await migrationService.migrateIfNeeded(user.id, plainPassword, oldHash);

      expect(result.migrated).toBe(true);
      expect(result.fromAlgorithm).toBe('bcrypt');
      expect(result.toAlgorithm).toBe('bcrypt-v2');

      const updatedUser = await userRepo.findById(user.id);
      expect(updatedUser!.passwordHash).not.toBe(oldHashValue);

      const verifyResult = await newHasher.verify(plainPassword, updatedUser!.passwordHash);
      expect(verifyResult).toBe(true);
    });

    it('登录时自动触发密码迁移', async () => {
      const oldHasher = new BcryptHasher(4);
      const newHasher = new WrapperHasher(new BcryptHasher(4), 'bcrypt-v2');

      ctx.hasherRegistry.register('bcrypt', oldHasher);
      ctx.hasherRegistry.register('bcrypt-v2', newHasher);
      ctx.hasherRegistry.setDefaultAlgorithm('bcrypt-v2');

      const plainPassword = 'LoginMigrate123';
      const oldHash = await oldHasher.hash(plainPassword);

      const user = await seedUserWithHash(ctx, {
        id: 'user-migrate-login',
        username: 'loginmigrator',
        passwordHash: oldHash,
      });

      const oldHashValue = user.passwordHash;

      await ctx.authService.login({ username: 'loginmigrator', password: plainPassword });

      const updatedUser = await ctx.userRepo.findById(user.id);
      expect(updatedUser!.passwordHash).not.toBe(oldHashValue);

      expect(ctx.hasherRegistry.detectAlgorithm(updatedUser!.passwordHash)).toBe('bcrypt');
    });

    it('迁移密码错误时不迁移', async () => {
      const oldHasher = new BcryptHasher(4);
      const newHasher = new WrapperHasher(new BcryptHasher(4), 'bcrypt-v2');

      const registry = new PasswordHasherRegistry('bcrypt-v2');
      registry.register('bcrypt', oldHasher);
      registry.register('bcrypt-v2', newHasher);

      const userRepo = new InMemoryUserRepository();
      const clock = new FakeClock(1_000_000_000_000);
      const migrationService = new PasswordMigrationService(registry, userRepo);

      const oldHash = await oldHasher.hash('CorrectPassword123');

      const user = {
        id: 'user-migrate-wrong',
        username: 'wrongmigrator',
        email: 'wrong@test.com',
        passwordHash: oldHash,
        status: 'enabled' as const,
        roles: [],
        createdAt: clock.now(),
      };
      await userRepo.save(user);

      const result = await migrationService.migrateIfNeeded(user.id, 'WrongPassword', oldHash);

      expect(result.migrated).toBe(false);

      const unchangedUser = await userRepo.findById(user.id);
      expect(unchangedUser!.passwordHash).toBe(oldHash);
    });
  });

  describe('NFR-001: 密码存储安全性', () => {
    it('BcryptHasher 强制最低 cost factor 为 10', () => {
      const hasher = new BcryptHasher(4);
      expect(hasher.getCostFactor()).toBeGreaterThanOrEqual(10);
    });

    it('cost factor 10+ 的哈希耗时满足安全下限', async () => {
      const hasher = new BcryptHasher(10);
      const start = performance.now();
      await hasher.hash('benchmark-test-password');
      const elapsed = performance.now() - start;

      expect(elapsed).toBeGreaterThan(50);
    });

    it('PasswordConfig 支持可配置的哈希耗时下限，默认 100ms', () => {
      expect(ctx.passwordConfig.getMinHashTimeMs()).toBe(100);
    });

    it('可修改哈希耗时下限', () => {
      ctx.passwordConfig.setMinHashTimeMs(200);
      expect(ctx.passwordConfig.getMinHashTimeMs()).toBe(200);
    });

    it('BcryptHasher.meetsMinTime 可校验哈希耗时是否达标', async () => {
      const hasher = new BcryptHasher(10);
      const meets = await hasher.meetsMinTime('test-password', 50);
      expect(meets).toBe(true);
    });

    it('BcryptHasher.measureHashTime 返回实际耗时', async () => {
      const hasher = new BcryptHasher(10);
      const elapsed = await hasher.measureHashTime('measure-test');
      expect(elapsed).toBeGreaterThan(0);
      expect(typeof elapsed).toBe('number');
    });

    it('PasswordStorageValidator 检测明文存储', () => {
      expect(PasswordStorageValidator.validate('plaintext').valid).toBe(false);
      expect(PasswordStorageValidator.validate('').valid).toBe(false);
    });

    it('PasswordStorageValidator 检测无盐 MD5', () => {
      const md5Hash = '5d41402abc4b2a76b9719d911017c592';
      expect(PasswordStorageValidator.validate(md5Hash).valid).toBe(false);
    });

    it('PasswordStorageValidator 检测无盐 SHA1', () => {
      const sha1Hash = 'aaf4c61ddcd540fab02241e01ad5f9a39e3bb3b8';
      expect(PasswordStorageValidator.validate(sha1Hash).valid).toBe(false);
    });

    it('迁移服务在算法一致时不迁移', async () => {
      const user = await seedUserWithHash(ctx, {
        username: 'alice',
        passwordHash: await ctx.hasher.hash('P@ssw0rd123'),
      });

      const result = await ctx.migrationService.migrateIfNeeded(
        user.id,
        'P@ssw0rd123',
        user.passwordHash,
      );

      expect(result.migrated).toBe(false);
    });
  });
});
