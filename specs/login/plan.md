# 技术设计: 包含失败锁定机制的账号密码登录系统

## 架构决策

| 决策项 | 选型 | 理由 |
|--------|------|------|
| 运行时 | Node.js + TypeScript（ESM） | 项目已定 `"type": "module"`，与 fixtures/login-app 现有配置一致 |
| Web 框架 | Express 5 + zod 校验 | 生态成熟，中间件模型适配审计/限流/错误处理横切需求；zod 提供 schema 驱动的输入校验 |
| 密码哈希 | bcrypt（可配置切换 argon2） | 带盐慢哈希，cost factor 可调以满足 NFR-001 的 ≥100ms 下限；通过 PasswordHasher 接口抽象，支持算法替换与迁移 |
| 认证凭证 | JWT（HS256，可配置切换 RS256） | 无状态凭证，自带过期时间，契合 FR-007 的凭证过期判定；登出通过服务端吊销列表实现即时失效 |
| 数据存储 | 内存仓库 + Repository 接口抽象 | 本项目为 SDD 受测 fixture，内存实现即可跑通全流程；Repository 接口预留 DB 替换点，不提前引入数据库依赖 |
| 配置管理 | 环境变量 + Config 模块 + 动态热更新通道 | 静态配置走 env，锁定阈值/时长等运行时可调参数走 Config 模块的 getter，实现不重启动态调整（NFR-003） |
| 审计日志 | 独立 AuditService，写追加日志文件 | 满足不可篡改与 90 天保留要求；不依赖外部日志系统，fixture 可独立运行 |
| 时钟 | 注入 Clock 接口 | 锁定到期判定（FR-004 AC-014）需要精确到秒，测试通过注入可控时钟验证边界 |

---

## 模块设计

### FR-001 对应设计: 账号密码登录

- **实现方案**
  1. 提供 `POST /api/login` 端点，接收 `{ username, password }` JSON 请求体。
  2. 请求进入时经 zod schema 校验：`username` 与 `password` 均为非空字符串，校验失败直接返回参数校验提示（AC-004）。
  3. 调用 `UserRepository.findByUsername(username, { caseSensitive })` 查找用户，`caseSensitive` 取自配置（AC-005）。
  4. 用户不存在时，不区分"不存在"与"密码错误"，统一返回"用户名或密码错误"（AC-002）。
  5. 用户存在但状态为 `disabled` 时，返回"账号已被禁用"（AC-003）——此提示在 spec 中明确要求区分，不违反 NFR-005。
  6. 密码校验委托 `PasswordHasher.verify(input, storedHash)`，不接触明文存储。
  7. 校验通过后调用 `SessionService.create(userId)` 签发 JWT，Token payload 含 `sub`(用户标识) 与 `exp`(过期时间戳)，返回 `{ token, expiresIn }`（AC-001）。
  8. 全程错误经统一 ErrorHandler 包装，不泄露技术细节。

- **涉及文件**
  - `src/handlers/login.ts` — 登录路由处理器
  - `src/services/auth-service.ts` — 认证编排逻辑（查找用户 → 校验密码 → 创建会话）
  - `src/repositories/user-repository.ts` — 用户查询接口
  - `src/schemas/login-schema.ts` — zod 输入校验 schema
  - `src/config/auth-config.ts` — 大小写策略等认证配置

- **数据流**
  ```
  Client → POST /api/login
    → zod 校验 (username/password 非空)
    → LockoutService.checkLockStatus(username)        [FR-004 前置]
    → UserRepository.findByUsername(username)
      ├─ 不存在 → 统一错误 "用户名或密码错误"
      └─ 存在 → 检查状态
           ├─ disabled → "账号已被禁用"
           └─ enabled → PasswordHasher.verify(password, hash)
                ├─ 不匹配 → 失败计数 +1 [FR-002] → 统一错误
                └─ 匹配 → 失败计数清零 [FR-002] → SessionService.create → 返回 Token
  ```

### FR-002 对应设计: 密码错误处理

- **实现方案**
  1. 密码校验失败后，调用 `LockoutService.recordFailure(userId)` 累加该账号连续失败计数（AC-006）。
  2. 失败计数写入 `AccountLock` 记录的 `failedAttempts` 字段，与用户记录关联。
  3. 返回的提示固定为"用户名或密码错误"，不含密码格式、哈希算法等任何技术信息（AC-008）。
  4. 若下一次登录密码正确，`AuthServiceImpl.login` 在密码校验通过后调用 `LockoutService.resetFailures(userId)` 清零计数（AC-007）。
  5. 失败计数操作与登录主流程串行执行（非异步旁路），保证计数准确性，但操作本身为内存读写，不显著影响性能（NFR-002）。

- **涉及文件**
  - `src/services/auth-service.ts` — 失败后调用 `recordFailure`，成功后调用 `resetFailures`
  - `src/services/lockout-service.ts` — `recordFailure` / `resetFailures` 实现
  - `src/models/account-lock.ts` — `failedAttempts` 字段定义
  - `src/utils/error-messages.ts` — 统一错误提示常量 `INVALID_CREDENTIALS`

- **数据流**
  ```
  PasswordHasher.verify → false
    → LockoutService.recordFailure(userId)
      → AccountLock.failedAttempts += 1
      → 若达到阈值 → 触发锁定 [FR-003]
    → 返回 { message: "用户名或密码错误" }

  PasswordHasher.verify → true
    → LockoutService.resetFailures(userId)
      → AccountLock.failedAttempts = 0
    → 继续会话创建流程
  ```

### FR-003 对应设计: 失败次数累计与账号锁定

- **实现方案**
  1. `LockoutService.recordFailure` 在累加后检查 `failedAttempts >= lockThreshold`，满足时调用 `lock(userId)` 设置 `AccountLock` 的 `lockedAt`（锁定起始时间）与 `lockDurationMs`（锁定时长毫秒）。
  2. 锁定阈值从 `LockoutConfig.getThreshold()` 读取，getter 内做下限保护：配置值 < 3 时返回 3（AC-011）。
  3. 锁定时长从 `LockoutConfig.getDurationMinutes()` 读取，默认 15 分钟；值为 0 时标记 `permanent: true` 表示永久锁定（AC-012）。
  4. 阈值与时长为运行时可调参数，`LockoutConfig` 从动态配置源读取，修改后对新触发的锁定立即生效（AC-011）。
  5. 锁定触发时写审计日志 `LOCK_TRIGGERED`（NFR-004）。

- **涉及文件**
  - `src/services/lockout-service.ts` — `recordFailure` / `lock` / 锁定判定逻辑
  - `src/models/account-lock.ts` — `lockedAt` / `lockDurationMs` / `permanent` 字段
  - `src/config/lockout-config.ts` — 阈值下限保护、时长默认值、永久锁定标记
  - `src/config/dynamic-config.ts` — 运行时热更新配置源

- **数据流**
  ```
  recordFailure(userId)
    → AccountLock.failedAttempts += 1
    → threshold = LockoutConfig.getThreshold()   // min 3
    → if (failedAttempts >= threshold)
        → AccountLock.lockedAt = Clock.now()
        → AccountLock.lockDurationMs = LockoutConfig.getDurationMinutes() * 60000
        → AccountLock.permanent = (durationMinutes === 0)
        → AuditService.log(LOCK_TRIGGERED, userId, ip)
        → 返回锁定提示 "账号已锁定，请于 X 分钟后重试"
  ```

### FR-004 对应设计: 锁定状态判定与恢复

- **实现方案**
  1. `LockoutService.checkLockStatus(userId)` 在每次登录请求入口处调用，作为认证流程的前置关卡。
  2. 判定逻辑：
     - `permanent === true` → 返回 `LOCKED_PERMANENT`（AC-015）。
     - `lockedAt == null` → 未锁定，放行。
     - 计算 `elapsed = Clock.now() - lockedAt`，`remaining = lockDurationMs - elapsed`。
     - `remaining > 0` → 仍锁定中，返回剩余分钟数（AC-009）。剩余不足 1 秒（`remaining > 0 && remaining < 1000`）仍视为锁定中（AC-014 边界）。
     - `remaining <= 0` → 锁定到期，调用 `unlock(userId)` 清除 `lockedAt`、重置 `failedAttempts` 为 0，写审计日志 `AUTO_UNLOCK`（AC-013），放行。
  3. 锁定期间即使密码正确也直接拒绝，不执行密码校验、不增加失败计数（AC-010）。
  4. 多次锁定周期独立计算：每次 `recordFailure` 达阈值时重新设置 `lockedAt` 为当前时间，不叠加旧 `lockedAt`（AC-016）。
  5. 自动解锁在下一次登录请求时触发（lazy unlock），不依赖后台定时任务。

- **涉及文件**
  - `src/services/lockout-service.ts` — `checkLockStatus` / `unlock` / `getRemainingMinutes`
  - `src/models/account-lock.ts` — 锁定状态字段
  - `src/utils/clock.ts` — `Clock` 接口与系统时钟实现，测试可注入虚拟时钟
  - `src/services/audit-service.ts` — `AUTO_UNLOCK` 日志记录

- **数据流**
  ```
  登录请求入口
    → LockoutService.checkLockStatus(userId)
      → if (permanent) → 拒绝 "账号已永久锁定，请联系管理员"
      → if (lockedAt == null) → 放行 → 继续认证
      → remaining = lockDurationMs - (now - lockedAt)
        ├─ remaining > 0 → 拒绝 "账号已锁定，请于 ceil(remaining/60000) 分钟后重试"
        │                  不校验密码，不增加计数
        └─ remaining <= 0 → unlock(userId)
                           → lockedAt = null, failedAttempts = 0
                           → AuditService.log(AUTO_UNLOCK)
                           → 放行 → 继续认证
  ```

### FR-005 对应设计: 管理员手动解锁

- **实现方案**
  1. 提供 `POST /api/admin/accounts/:userId/unlock` 端点。
  2. 路由经 `AuthMiddleware.requireRole('admin')` 中间件守卫，非管理员角色返回 403 "无权限"（AC-020）。
  3. 处理器调用 `LockoutService.adminUnlock(userId)`：
     - 先查 `UserRepository.exists(userId)`，不存在时返回"账号不存在"（AC-018），不产生副作用。
     - 存在时清除锁定状态、重置失败计数，写审计日志 `ADMIN_UNLOCK`。
     - 对未锁定账号同样执行清除操作（幂等），不报错（AC-019）。
  4. 解锁不受 `permanent` 标志限制，强制清除（AC-015 中"仅管理员手动解锁可恢复"的逆向操作）。

- **涉及文件**
  - `src/handlers/admin-unlock.ts` — 管理员解锁路由处理器
  - `src/services/lockout-service.ts` — `adminUnlock` 方法（强制清除 + 幂等）
  - `src/middleware/auth-middleware.ts` — `requireRole('admin')` 角色守卫
  - `src/services/audit-service.ts` — `ADMIN_UNLOCK` 日志记录

- **数据流**
  ```
  Admin Client → POST /api/admin/accounts/:userId/unlock
    → AuthMiddleware.requireRole('admin')
      ├─ 非管理员 → 403 "无权限"
      └─ 管理员 → LockoutService.adminUnlock(userId)
        → UserRepository.exists(userId)
          ├─ false → 404 "账号不存在"
          └─ true → lockedAt = null, failedAttempts = 0, permanent = false
                   → AuditService.log(ADMIN_UNLOCK, userId, adminId, ip)
                   → 200 { message: "解锁成功" }  // 未锁定时幂等返回相同结果
  ```

### FR-006 对应设计: 密码安全存储与校验

- **实现方案**
  1. 定义 `PasswordHasher` 接口：`hash(plain: string): Promise<string>` 与 `verify(plain: string, hash: string): Promise<boolean>`。
  2. 默认实现 `BcryptHasher`：使用 bcrypt，cost factor 从配置读取（默认 12，对应约 200-400ms，满足 NFR-001 ≥100ms）。
  3. 每次哈希由 bcrypt 自动生成独立盐值，相同明文产生不同哈希（AC-021）。
  4. 注册时调用 `hash` 存储，登录时调用 `verify` 比对，全程不存储或日志记录明文（AC-022）。
  5. 算法标识存入哈希结果前缀（如 `$2b$` 为 bcrypt），`PasswordHasher` 通过前缀路由到对应实现，支持多算法共存（AC-023 兼容校验）。
  6. 提供迁移接口 `PasswordMigrationService.migrate(userId, plain)`：登录时检测到旧算法哈希且校验通过，自动用新算法重新哈希并更新存储。

- **涉及文件**
  - `src/services/password-hasher.ts` — 接口定义 + 工厂
  - `src/services/bcrypt-hasher.ts` — bcrypt 默认实现
  - `src/services/password-migration.ts` — 算法迁移逻辑（可选启用）
  - `src/config/password-config.ts` — cost factor、算法选择、迁移策略配置

- **数据流**
  ```
  用户注册/改密:
    plain password → PasswordHasher.hash(plain) → bcrypt hash($2b$...) → 存储

  登录校验:
    input password → PasswordHasher.verify(input, storedHash)
      → bcrypt.compare(input, storedHash)
      → true / false
      → (可选) 若 storedHash 为旧算法且 verify 通过 → 重新 hash → 更新存储
  ```

### FR-007 对应设计: 登录会话与凭证管理

- **实现方案**
  1. `SessionService.create(userId)` 生成 JWT，payload 含 `sub`(userId)、`iat`(签发时间)、`exp`(签发时间 + TTL)，签名密钥从配置读取。
  2. 凭证有效期 `tokenTTL` 可配置，默认如 3600 秒。返回 `{ token, expiresIn, expiresAt }`（AC-024）。
  3. 提供 `AuthMiddleware.authenticate` 中间件解析 JWT 并校验 `exp`：过期则返回 401 "登录已过期，请重新登录"（AC-025）。
  4. 提供 `POST /api/logout` 端点：将当前 Token 的 `jti`（唯一标识）加入服务端吊销列表 `TokenRevocationList`，后续携带该 Token 的请求被拒绝（AC-026）。
  5. 多设备并发登录策略（AC-027）：
     - 策略 `ALLOW_MULTI`：允许多 Token 同时有效，各自独立过期。
     - 策略 `SINGLE_SESSION`：新登录时吊销同账号已有 Token（通过 `ActiveSessionRegistry` 追踪 userId → token 映射）。
     - 策略从配置读取，可动态切换。
  6. 吊销列表与活跃会话注册表为内存实现（Repository 接口抽象，可替换为 Redis 等）。

- **涉及文件**
  - `src/services/session-service.ts` — Token 签发、过期校验、会话策略
  - `src/handlers/logout.ts` — 登出路由处理器
  - `src/middleware/auth-middleware.ts` — `authenticate`（Token 解析 + 过期/吊销校验）
  - `src/models/token-revocation-list.ts` — 吊销列表（内存 Set）
  - `src/models/active-session-registry.ts` — 活跃会话映射（多设备策略用）
  - `src/config/session-config.ts` — TTL、会话策略、签名密钥配置

- **数据流**
  ```
  登录成功:
    → SessionService.create(userId)
      → jwt.sign({ sub, iat, exp }, secretKey)
      → (SINGLE_SESSION 策略) 吊销旧 Token → 注册新 Token
      → 返回 { token, expiresIn, expiresAt }

  后续请求:
    → AuthMiddleware.authenticate
      → jwt.verify(token)
        ├─ 过期 → 401 "登录已过期，请重新登录"
        ├─ 在吊销列表 → 401 "凭证已失效"
        └─ 有效 → 注入 req.user → 放行

  登出:
    → POST /api/logout (携带 Token)
    → AuthMiddleware.authenticate → 通过
    → SessionService.revoke(token.jti)
      → TokenRevocationList.add(jti)
      → AuditService.log(LOGOUT, userId, ip)
      → 200 { message: "登出成功" }
  ```

### NFR-001 对应设计: 密码存储安全性

- **实现方案**
  1. 强制使用带盐慢哈希，`PasswordHasher` 工厂拒绝注册无盐或可逆算法实现（编译期接口约束 + 运行期算法白名单校验）。
  2. bcrypt cost factor 下限校验：`PasswordConfig.getCostFactor()` 返回值 < 10 时强制提升为 10（对应约 100ms+），满足 NFR 要求的校验耗时下限。
  3. 启动时自检：对固定测试串执行一次 `hash`，测量耗时，低于 100ms 时打印警告日志（不阻止启动，但标记安全等级降级）。
  4. 数据库字段审计：提供 `PasswordStorageValidator` 工具方法，扫描存储层密码字段，检测到明文或无盐哈希（如 32 位 hex MD5）时报错。

- **涉及文件**
  - `src/services/password-hasher.ts` — 算法白名单与工厂守卫
  - `src/config/password-config.ts` — cost factor 下限
  - `src/utils/password-storage-validator.ts` — 存储安全审计工具
  - `tests/password-security.test.ts` — 验证哈希耗时下限、无明文存储

### NFR-002 对应设计: 登录接口响应性能

- **实现方案**
  1. 在 Express 请求生命周期中注入计时中间件 `PerformanceMiddleware`，记录 `/api/login` 的处理耗时。
  2. 锁定判定与失败计数为内存读写（O(1)），不引入 I/O 阻塞，保证不拖慢主流程。
  3. bcrypt 校验耗时（约 100-400ms）是登录主路径最大开销，cost factor 在安全下限附近取值以平衡安全与性能。
  4. 审计日志写入采用非阻塞追加（`fs.appendFile` 异步回调或写入队列），不等待落盘即返回响应。
  5. 压测脚本 `tests/perf/login-load.test.ts` 模拟并发登录，输出 P95/P99 分位数据，断言 P95 < 500ms、P99 < 1000ms。

- **涉及文件**
  - `src/middleware/performance-middleware.ts` — 请求计时与分位统计
  - `src/services/audit-service.ts` — 异步日志写入
  - `tests/perf/login-load.test.ts` — 性能压测

### NFR-003 对应设计: 防暴力破解能力

- **实现方案**
  1. 单账号维度：FR-003 的失败锁定机制已覆盖。
  2. IP 维度（可选增强）：`IpRateLimiter` 中间件基于滑动窗口计数，对同一 IP 的登录失败请求限流。阈值可配置（如 10 次/分钟），超限返回 429 并临时封禁 IP（默认 5 分钟）。
  3. 限流器使用内存 Map（IP → 失败计数 + 窗口起始时间），定时清理过期条目。
  4. 动态调整：锁定阈值/时长/IP 限流参数均从 `DynamicConfig` 读取，`DynamicConfig` 支持运行时通过管理接口 `POST /api/admin/config` 更新，无需重启。
  5. IP 封禁与账号锁定独立运作：IP 被封禁时不影响其他 IP 的正常账号登录。

- **涉及文件**
  - `src/middleware/ip-rate-limiter.ts` — IP 维度限流
  - `src/config/dynamic-config.ts` — 运行时热更新配置源
  - `src/handlers/admin-config.ts` — 管理接口动态调整配置
  - `tests/security/brute-force.test.ts` — 暴力破解防护验证

### NFR-004 对应设计: 审计日志

- **实现方案**
  1. `AuditService.log(eventType, userId, ip, result, meta?)` 统一入口，写入追加模式日志文件 `logs/audit-YYYY-MM-DD.log`。
  2. 事件类型枚举：`LOGIN_SUCCESS` / `LOGIN_FAILED`（含失败次数）/ `LOCK_TRIGGERED` / `AUTO_UNLOCK` / `ADMIN_UNLOCK` / `LOGOUT`。
  3. 日志格式为 JSON Lines，每行一条：`{ ts, eventType, userId, ip, result, meta }`。
  4. 不可篡改保障：日志文件权限设为追加只读（`chmod 0440`，Windows 下通过 ACL 限制），普通用户无写权限。
  5. 保留策略：日志按天轮转，`LogRetentionJob` 定时清理 90 天前的日志文件（保留期 ≥ 90 天）。
  6. 登录失败日志的 `meta` 含 `failedAttempts` 当前值但不含密码或哈希信息（NFR-005）。

- **涉及文件**
  - `src/services/audit-service.ts` — 统一日志入口
  - `src/models/audit-log-entry.ts` — 日志条目结构与事件枚举
  - `src/utils/log-retention.ts` — 日志轮转与保留清理
  - `tests/audit/audit-log.test.ts` — 审计日志完整性验证

### NFR-005 对应设计: 错误提示安全性

- **实现方案**
  1. 所有对外错误响应经 `ErrorHandler` 中间件统一包装，输出格式 `{ error: { code, message } }`，`message` 仅含业务级提示。
  2. 预定义业务错误码与提示常量集 `ErrorMessages`：
     - `INVALID_CREDENTIALS` → "用户名或密码错误"
     - `ACCOUNT_DISABLED` → "账号已被禁用"
     - `ACCOUNT_LOCKED` → "账号已锁定，请于 X 分钟后重试"
     - `ACCOUNT_LOCKED_PERMANENT` → "账号已永久锁定，请联系管理员"
     - `VALIDATION_ERROR` → "用户名和密码不能为空"
     - `FORBIDDEN` → "无权限"
     - `TOKEN_EXPIRED` → "登录已过期，请重新登录"
     - `TOKEN_REVOKED` → "凭证已失效"
  3. 未捕获异常（如数据库错误）统一映射为 `INTERNAL_ERROR` → "系统繁忙，请稍后重试"，原始堆栈仅写服务端日志。
  4. 密码校验逻辑不返回任何中间状态（不区分"用户不存在"与"密码错误"，不返回哈希比对细节）。
  5. 审计日志可记录技术细节（如异常堆栈），但日志文件不对普通用户暴露。

- **涉及文件**
  - `src/middleware/error-handler.ts` — 统一错误包装中间件
  - `src/utils/error-messages.ts` — 业务错误码与提示常量
  - `src/utils/app-error.ts` — 自定义 Error 类（区分 code 与内部 message）
  - `tests/security/error-leak.test.ts` — 验证错误提示不泄露内部信息

---

## 风险与约束

| 编号 | 风险/约束 | 影响 | 缓解措施 |
|------|----------|------|----------|
| R-01 | bcrypt cost factor 过高导致登录耗时超出 NFR-002 的 P99 1000ms 上限 | 性能 | cost factor 取安全下限附近值（10-12），启动自检实测耗时，压测验证 P99 达标 |
| R-02 | 内存存储重启后数据丢失，锁定状态/失败计数/吊销列表清零 | 正确性 | 本项目为 SDD fixture，内存实现可接受；生产替换为 DB/Redis，Repository 接口已预留 |
| R-03 | JWT 无状态凭证的登出即时失效依赖服务端吊销列表，重启后吊销列表丢失 | 安全 | 内存 fixture 可接受；生产用 Redis 持久化吊销列表，或采用短 TTL Token 降低风险窗口 |
| R-04 | 时钟依赖 `Clock` 接口，系统时钟回拨可能导致锁定到期判定异常 | 正确性 | `Clock` 接口测试覆盖时钟回拨场景；生产使用 NTP 同步 |
| R-05 | 动态配置更新无版本控制，误操作可能将锁定阈值设为极低值 | 安全 | 管理接口写入前做参数范围校验（阈值 ≥ 3），记录配置变更审计日志 |
| R-06 | 审计日志写入失败不应影响登录主流程可用性 | 可靠性 | 审计写入为异步 fire-and-forget，失败时缓冲重试；连续失败时降级为仅写 stderr 并告警 |
| C-01 | 本项目仅实现后端 API，不含前端登录页面 | 范围 | spec 未要求前端，API 契约以 JSON 定义，前端可独立对接 |
| C-02 | 固定依赖 Node.js 运行时，不考虑其他语言实现 | 约束 | 项目 package.json 已定 TypeScript ESM |
