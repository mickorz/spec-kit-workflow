# 任务清单: 包含失败锁定机制的账号密码登录系统

## T-001: 账号密码登录
- **FR**: FR-001
- **AC**: AC-001, AC-002, AC-003, AC-004, AC-005
- **Status**: done

## T-002: 密码错误处理
- **FR**: FR-002
- **AC**: AC-006, AC-007, AC-008
- **Status**: done

## T-003: 失败次数累计与账号锁定
- **FR**: FR-003
- **AC**: AC-009, AC-010, AC-011, AC-012
- **Status**: done

## T-004: 锁定状态判定与恢复
- **FR**: FR-004
- **AC**: AC-013, AC-014, AC-015, AC-016
- **Status**: done

## T-005: 管理员手动解锁
- **FR**: FR-005
- **AC**: AC-017, AC-018, AC-019, AC-020
- **Status**: done

## T-006: 密码安全存储与校验
- **FR**: FR-006
- **AC**: AC-021, AC-022, AC-023
- **Status**: done

## T-007: 登录会话与凭证管理
- **FR**: FR-007
- **AC**: AC-024, AC-025, AC-026, AC-027
- **Status**: done

## T-008: 密码存储安全性
- **NFR**: NFR-001
- **Status**: done

## T-009: 登录接口响应性能
- **NFR**: NFR-002
- **Status**: done

## T-010: 防暴力破解能力
- **NFR**: NFR-003
- **Status**: done

## T-011: 审计日志
- **NFR**: NFR-004
- **Status**: done

## T-012: 错误提示安全性
- **NFR**: NFR-005
- **Status**: done

<!-- ID 规则：T-NNN 三位数字从 001 起不重复；旧任务不删除只改 Status -->
<!-- Status 枚举：pending | in-progress | done | blocked -->


<!-- 以下为 round 1 追加的修复任务 -->
## T-013: 修复 测试基础设施 - build
- **来源**: evidence.json round 1
- **类型**: 测试基础设施
- **原因**: 构建失败
- **Status**: done

## T-014: 修复 测试基础设施 - none
- **来源**: evidence.json round 1
- **类型**: 测试基础设施
- **原因**: 测试命令退出 0 但无实际测试执行记录
- **Status**: done

## T-015: 修复 FR-003 - 部分实现
- **来源**: review.json round 1
- **类型**: 需求缺口
- **需求**: FR-003
- **状态**: 部分实现
- **详情**: 失败计数器存在（recordFailure/resetFailures），但失败达阈值时自动锁定逻辑未实现（lockout-service.ts:26 注释明确写'不实现失败次数达到阈值时的自动锁定'）。AC-009 自动锁定触发缺失：recordFailure 仅递增 failedAttempts，从不与阈值比较、从不设置 lockedAt。AC-011 锁定阈值无配置参数，无最小值 3 强制。AC-012 锁定时长无配置参数，无默认 15 分钟，无'配置为 0 表示永久锁定'逻辑。AC-010 锁定拒绝逻辑存在于 checkLockStatus，但因自动锁定未实现无法通过失败路径触发，也无测试验证非永久锁定下正确密码被拒且计数不增加。
- **关联验收**: AC-009, AC-010, AC-011, AC-012
- **Status**: done

## T-016: 修复 FR-006 - 部分实现
- **来源**: review.json round 1
- **类型**: 需求缺口
- **需求**: FR-006
- **状态**: 部分实现
- **详情**: AC-021/AC-022 已实现并测试（bcrypt 带盐哈希、哈希比对）。AC-023 密码迁移服务（password-migration.ts）存在但未集成到登录流程——auth-service.ts 检测算法并用对应 hasher 校验（旧算法兼容），但不调用 migrateIfNeeded 做重新哈希迁移。password-migration.ts 有 TypeScript 编译错误（第 40/52 行 detectedAlgo 类型 string|null 赋值给 string）。迁移测试仅覆盖'算法一致无需迁移'场景，未测试实际从旧算法迁移到新算法的完整路径。
- **关联验收**: AC-021, AC-022, AC-023
- **Status**: done

## T-017: 修复 NFR-001 - 部分实现
- **来源**: review.json round 1
- **类型**: 需求缺口
- **需求**: NFR-001
- **状态**: 部分实现
- **详情**: bcrypt 带盐慢哈希已实现，BcryptHasher 强制最低 cost factor 为 10，PasswordStorageValidator 可检测明文/无盐 MD5/SHA1 存储。但'哈希计算开销不低于可配置下限（默认 100ms）'未实现为可配置参数——代码仅强制 cost factor 下限，无耗时门槛校验。测试仅验证 cost factor 10 耗时 >50ms，未达到 spec 要求的 100ms 默认下限。
- **关联验收**: 无
- **Status**: done

## T-018: 修复 NFR-002 - 证据不足
- **来源**: review.json round 1
- **类型**: 需求缺口
- **需求**: NFR-002
- **状态**: 证据不足
- **详情**: PerformanceMiddleware 可收集 P95/P99 分位统计数据，但测试未断言 P95<=500ms 或 P99<=1000ms 的具体阈值——仅验证统计功能可用及耗时 >0。构建失败（admin-unlock.ts 和 password-migration.ts 的 TypeScript 编译错误）导致全部测试未实际执行，无运行期性能证据。
- **关联验收**: 无
- **Status**: done

## T-019: 修复 NFR-003 - 部分实现
- **来源**: review.json round 1
- **类型**: 需求缺口
- **需求**: NFR-003
- **状态**: 部分实现
- **详情**: IP 维度登录失败频率限制已实现并测试（IpRateLimiter 含限流/封禁/到期恢复/参数动态调整）。但'单账号连续失败达阈值即锁定'依赖 FR-003 自动锁定逻辑，该逻辑未实现。锁定参数（阈值、时长）未作为可配置项存在于 LockoutService 中——LockoutService 构造函数不接受配置参数，无法在不重启情况下动态调整锁定阈值与时长。
- **关联验收**: 无
- **Status**: done

## T-020: 修复 NFR-004 - 部分实现
- **来源**: review.json round 1
- **类型**: 需求缺口
- **需求**: NFR-004
- **状态**: 部分实现
- **详情**: 登录成功/失败（含 failedAttempts）/自动解锁/管理员解锁/登出事件已记录并测试，日志含时间戳/账号标识/IP/事件类型/结果。但 LOCK_TRIGGERED 事件类型虽在 AuditEventType 枚举中定义却从未被记录（因 FR-003 自动锁定未实现）。日志防篡改未实现——AuditService 为内存数组，clear() 方法可清空全部日志，任何持有引用的代码可修改。90 天保留策略未实现——无持久化存储，服务重启后日志丢失。
- **关联验收**: 无
- **Status**: done
