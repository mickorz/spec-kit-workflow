import { randomUUID } from 'crypto';
import { DynamicConfig } from '../../src/config/dynamic-config.js';
import { AuthConfig } from '../../src/config/auth-config.js';
import { PasswordConfig } from '../../src/config/password-config.js';
import { SessionConfig } from '../../src/config/session-config.js';
import { LockoutConfig } from '../../src/config/lockout-config.js';
import { FakeClock } from '../../src/utils/clock.js';
import { InMemoryUserRepository } from '../../src/repositories/user-repository.js';
import { InMemoryAccountLockStore } from '../../src/repositories/account-lock-store.js';
import { BcryptHasher } from '../../src/services/bcrypt-hasher.js';
import { PasswordHasherRegistry } from '../../src/services/password-hasher.js';
import { AuditService } from '../../src/services/audit-service.js';
import { LockoutService } from '../../src/services/lockout-service.js';
import { SessionService } from '../../src/services/session-service.js';
import { AuthService } from '../../src/services/auth-service.js';
import { PasswordMigrationService } from '../../src/services/password-migration.js';
import { TokenRevocationList } from '../../src/models/token-revocation-list.js';
import { ActiveSessionRegistry } from '../../src/models/active-session-registry.js';
import { IpRateLimiter } from '../../src/middleware/ip-rate-limiter.js';
import { PerformanceMiddleware } from '../../src/middleware/performance-middleware.js';
import { createApp, type AppDeps } from '../../src/index.js';
import type { User, UserStatus } from '../../src/models/user.js';
import type { PasswordHasher } from '../../src/services/password-hasher.js';

export interface TestContext {
  config: DynamicConfig;
  authConfig: AuthConfig;
  passwordConfig: PasswordConfig;
  sessionConfig: SessionConfig;
  lockoutConfig: LockoutConfig;
  clock: FakeClock;
  userRepo: InMemoryUserRepository;
  lockStore: InMemoryAccountLockStore;
  hasherRegistry: PasswordHasherRegistry;
  hasher: PasswordHasher;
  auditService: AuditService;
  lockoutService: LockoutService;
  sessionService: SessionService;
  authService: AuthService;
  migrationService: PasswordMigrationService;
  revocationList: TokenRevocationList;
  activeSessions: ActiveSessionRegistry;
  ipRateLimiter: IpRateLimiter;
  perfMiddleware: PerformanceMiddleware;
  app: ReturnType<typeof createApp>;
}

export interface CreateTestContextOptions {
  costFactor?: number;
  caseSensitive?: boolean;
  sessionTTLSeconds?: number;
  sessionPolicy?: 'ALLOW_MULTI' | 'SINGLE_SESSION';
  secretKey?: string;
  rateLimitMaxFailures?: number;
  rateLimitWindowMinutes?: number;
  rateLimitBanMinutes?: number;
  lockoutThreshold?: number;
  lockoutDurationMinutes?: number;
}

export function createTestContext(opts: CreateTestContextOptions = {}): TestContext {
  const config = new DynamicConfig();
  config.set('auth.caseSensitive', opts.caseSensitive ?? true);
  config.set('session.ttlSeconds', opts.sessionTTLSeconds ?? 3600);
  config.set('session.secretKey', opts.secretKey ?? 'test-secret-key-for-testing-only');
  config.set('session.policy', opts.sessionPolicy ?? 'ALLOW_MULTI');
  config.set('password.costFactor', opts.costFactor ?? 4);
  config.set('password.algorithm', 'bcrypt');
  config.set('password.minHashTimeMs', 100);
  config.set('lockout.threshold', opts.lockoutThreshold ?? 5);
  config.set('lockout.durationMinutes', opts.lockoutDurationMinutes ?? 15);
  config.set('rateLimit.maxFailures', opts.rateLimitMaxFailures ?? 10);
  config.set('rateLimit.windowMinutes', opts.rateLimitWindowMinutes ?? 1);
  config.set('rateLimit.banMinutes', opts.rateLimitBanMinutes ?? 5);

  const clock = new FakeClock(1_000_000_000_000);
  const authConfig = new AuthConfig(config);
  const passwordConfig = new PasswordConfig(config);
  const sessionConfig = new SessionConfig(config);
  const lockoutConfig = new LockoutConfig(config);

  const auditService = new AuditService(clock);
  const lockStore = new InMemoryAccountLockStore();
  const lockoutService = new LockoutService(lockStore, clock, auditService, lockoutConfig);

  const bcryptHasher = new BcryptHasher(opts.costFactor ?? 4);
  const hasherRegistry = new PasswordHasherRegistry('bcrypt');
  hasherRegistry.register('bcrypt', bcryptHasher);

  const userRepo = new InMemoryUserRepository();
  const revocationList = new TokenRevocationList();
  const activeSessions = new ActiveSessionRegistry();
  const sessionService = new SessionService(sessionConfig, clock, revocationList, activeSessions, auditService);
  const migrationService = new PasswordMigrationService(hasherRegistry, userRepo);
  const authService = new AuthService(userRepo, hasherRegistry, lockoutService, sessionService, authConfig, auditService, migrationService);

  const ipRateLimiter = new IpRateLimiter(config, clock);
  const perfMiddleware = new PerformanceMiddleware();

  const deps: AppDeps = {
    config,
    authConfig,
    passwordConfig,
    sessionConfig,
    lockoutConfig,
    clock,
    userRepo,
    lockStore,
    hasherRegistry,
    auditService,
    lockoutService,
    sessionService,
    authService,
    migrationService,
    revocationList,
    activeSessions,
    ipRateLimiter,
    perfMiddleware,
  };
  const app = createApp(deps);

  return {
    config,
    authConfig,
    passwordConfig,
    sessionConfig,
    lockoutConfig,
    clock,
    userRepo,
    lockStore,
    hasherRegistry,
    hasher: bcryptHasher,
    auditService,
    lockoutService,
    sessionService,
    authService,
    migrationService,
    revocationList,
    activeSessions,
    ipRateLimiter,
    perfMiddleware,
    app,
  };
}

export async function seedUser(
  ctx: TestContext,
  opts: {
    id?: string;
    username: string;
    password: string;
    status?: UserStatus;
    roles?: string[];
    email?: string;
  },
): Promise<User> {
  const hash = await ctx.hasher.hash(opts.password);
  const user: User = {
    id: opts.id ?? randomUUID(),
    username: opts.username,
    email: opts.email ?? `${opts.username}@test.com`,
    passwordHash: hash,
    status: opts.status ?? 'enabled',
    roles: opts.roles ?? [],
    createdAt: ctx.clock.now(),
  };
  await ctx.userRepo.save(user);
  return user;
}

export async function seedUserWithHash(
  ctx: TestContext,
  opts: {
    id?: string;
    username: string;
    passwordHash: string;
    status?: UserStatus;
    roles?: string[];
  },
): Promise<User> {
  const user: User = {
    id: opts.id ?? randomUUID(),
    username: opts.username,
    email: `${opts.username}@test.com`,
    passwordHash: opts.passwordHash,
    status: opts.status ?? 'enabled',
    roles: opts.roles ?? [],
    createdAt: ctx.clock.now(),
  };
  await ctx.userRepo.save(user);
  return user;
}
