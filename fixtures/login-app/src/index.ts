import express, { type Express } from 'express';
import { DynamicConfig } from './config/dynamic-config.js';
import { AuthConfig } from './config/auth-config.js';
import { PasswordConfig } from './config/password-config.js';
import { SessionConfig } from './config/session-config.js';
import { LockoutConfig } from './config/lockout-config.js';
import { SystemClock, type Clock } from './utils/clock.js';
import { InMemoryUserRepository } from './repositories/user-repository.js';
import { InMemoryAccountLockStore } from './repositories/account-lock-store.js';
import { BcryptHasher } from './services/bcrypt-hasher.js';
import { PasswordHasherRegistry } from './services/password-hasher.js';
import { AuditService } from './services/audit-service.js';
import { LockoutService } from './services/lockout-service.js';
import { SessionService } from './services/session-service.js';
import { AuthService } from './services/auth-service.js';
import { PasswordMigrationService } from './services/password-migration.js';
import { TokenRevocationList } from './models/token-revocation-list.js';
import { ActiveSessionRegistry } from './models/active-session-registry.js';
import { IpRateLimiter } from './middleware/ip-rate-limiter.js';
import { PerformanceMiddleware } from './middleware/performance-middleware.js';
import { authenticate, requireRole } from './middleware/auth-middleware.js';
import { errorHandler } from './middleware/error-handler.js';
import { createLoginHandler } from './handlers/login.js';
import { createLogoutHandler } from './handlers/logout.js';
import { createAdminUnlockHandler } from './handlers/admin-unlock.js';

export interface AppDeps {
  config: DynamicConfig;
  authConfig: AuthConfig;
  passwordConfig: PasswordConfig;
  sessionConfig: SessionConfig;
  lockoutConfig: LockoutConfig;
  clock: Clock;
  userRepo: InMemoryUserRepository;
  lockStore: InMemoryAccountLockStore;
  hasherRegistry: PasswordHasherRegistry;
  auditService: AuditService;
  lockoutService: LockoutService;
  sessionService: SessionService;
  authService: AuthService;
  migrationService: PasswordMigrationService;
  revocationList: TokenRevocationList;
  activeSessions: ActiveSessionRegistry;
  ipRateLimiter: IpRateLimiter;
  perfMiddleware: PerformanceMiddleware;
}

export function createAppDeps(config?: DynamicConfig): AppDeps {
  const cfg = config ?? new DynamicConfig();
  const clock = new SystemClock();

  const authConfig = new AuthConfig(cfg);
  const passwordConfig = new PasswordConfig(cfg);
  const sessionConfig = new SessionConfig(cfg);
  const lockoutConfig = new LockoutConfig(cfg);

  const auditService = new AuditService(clock);
  const lockStore = new InMemoryAccountLockStore();
  const lockoutService = new LockoutService(lockStore, clock, auditService, lockoutConfig);

  const bcryptHasher = new BcryptHasher(passwordConfig.getCostFactor());
  const hasherRegistry = new PasswordHasherRegistry(passwordConfig.getAlgorithm());
  hasherRegistry.register('bcrypt', bcryptHasher);

  const userRepo = new InMemoryUserRepository();
  const revocationList = new TokenRevocationList();
  const activeSessions = new ActiveSessionRegistry();
  const sessionService = new SessionService(sessionConfig, clock, revocationList, activeSessions, auditService);
  const migrationService = new PasswordMigrationService(hasherRegistry, userRepo);
  const authService = new AuthService(userRepo, hasherRegistry, lockoutService, sessionService, authConfig, auditService, migrationService);

  const ipRateLimiter = new IpRateLimiter(cfg, clock);
  const perfMiddleware = new PerformanceMiddleware();

  return {
    config: cfg,
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
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.use(express.json());

  app.post('/api/login', deps.perfMiddleware.track('/api/login'), createLoginHandler(deps.authService));
  app.post('/api/logout', authenticate(deps.sessionService), createLogoutHandler(deps.sessionService));
  app.post(
    '/api/admin/accounts/:userId/unlock',
    authenticate(deps.sessionService),
    requireRole('admin'),
    createAdminUnlockHandler(deps.lockoutService, deps.userRepo),
  );

  app.use(errorHandler);
  return app;
}

export default createApp;
