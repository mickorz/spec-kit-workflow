import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

/*
 * 账号密码登录系统（含失败锁定）核心模块
 *
 * 流程概览：
 *
 *   login(user, pass, ip)
 *     ├── 参数校验（空值）            → "用户名和密码不能为空"
 *     ├── 账号查找                    → 不存在 → "用户名或密码错误"（不泄露）
 *     ├── 禁用判定                    → "账号已被禁用"
 *     ├── 锁定判定
 *     │     ├── 永久锁定（duration=0）→ 拒绝，不增计数
 *     │     ├── 未到期                 → 拒绝，不增计数（AC-010）
 *     │     └── 已到期                 → 自动解锁，清零计数（AC-013）→ 继续往下
 *     ├── 密码校验（scrypt 带盐慢哈希）
 *     │     ├── 匹配 → 清零计数 → 创建会话 → 返回 token
 *     │     └── 不匹配 → 计数+1 → 达阈值则锁定 → "用户名或密码错误"
 *     └── 审计日志全程记录（含来源 IP）
 *
 *   锁定参数（阈值 threshold、时长 durationMs）可通过 updateLockConfig 动态调整，
 *   仅对"新触发的锁定"生效；已锁定账号保持其锁定时的参数。
 */

// ===== 公共类型 =====

export interface LoginResult {
  success: boolean
  token?: string
  error?: string
  remainingLockTime?: number // 锁定剩余秒数；-1 表示永久锁定
}

export interface LockStatus {
  locked: boolean
  failedAttempts: number
  lockedAt?: number // 锁定起始时间戳(ms)
  lockDurationMs?: number
}

export interface AuditEntry {
  timestamp: number
  username: string
  ip: string
  event: string
  result: string
}

// ===== 内部类型 =====

interface UserRecord {
  username: string
  passwordHash: string // 格式: scrypt$<saltHex>$<hashHex>
  disabled: boolean
  failedAttempts: number
  lockedAt?: number
  lockDurationMs?: number
}

interface SessionRecord {
  username: string
  expiresAt: number
  revoked: boolean
}

// ===== 可配置密码哈希（AC-023 / NFR-001）=====
export interface PasswordHasher {
  algorithmName: string
  minCostMs: number
  hash(password: string): string
  verify(password: string, stored: string): boolean
}

class ScryptHasher implements PasswordHasher {
  algorithmName = 'scrypt'
  minCostMs: number
  private n: number
  private r: number
  private p: number
  private keylen: number

  constructor(minCostMs = 100) {
    this.minCostMs = minCostMs
    // NFR-001: N=65536 确保单次哈希耗时 >= 可配置下限（默认 100ms）
    this.n = 65536
    this.r = 8
    this.p = 1
    this.keylen = 64
  }

  hash(password: string): string {
    const salt = randomBytes(16)
    const hash = scryptSync(password, salt, this.keylen, { N: this.n, r: this.r, p: this.p, maxmem: 128 * 1024 * 1024 })
    return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`
  }

  verify(password: string, stored: string): boolean {
    const parts = stored.split('$')
    if (parts.length !== 3 || parts[0] !== 'scrypt') return false
    const salt = Buffer.from(parts[1], 'hex')
    const expected = Buffer.from(parts[2], 'hex')
    const actual = scryptSync(password, salt, this.keylen, { N: this.n, r: this.r, p: this.p, maxmem: 128 * 1024 * 1024 })
    if (expected.length !== actual.length) return false
    return timingSafeEqual(expected, actual)
  }
}

// NFR-001: 哈希开销验证结果
let hashCostValidation: { measured: number, minimum: number, valid: boolean } | null = null

function validateHashCost(): void {
  const start = Date.now()
  currentHasher.hash('cost-validation')
  let measured = Date.now() - start
  hashCostValidation = { measured, minimum: currentHasher.minCostMs, valid: measured >= currentHasher.minCostMs }
  // NFR-001: 低于可配置下限时增大 N 参数重新校准
  while (!hashCostValidation.valid && currentHasher instanceof ScryptHasher) {
    const sh = currentHasher as any
    if (sh.n >= 131072) break // 上限 128K 防止内存爆炸
    sh.n *= 2
    const recheck = Date.now()
    currentHasher.hash('cost-revalidation')
    measured = Date.now() - recheck
    hashCostValidation.measured = measured
    hashCostValidation.valid = measured >= currentHasher.minCostMs
  }
}

let currentHasher: PasswordHasher = new ScryptHasher(100)
// 支持旧算法兼容校验（迁移策略）
let legacyHashers: PasswordHasher[] = []

export function setHasher(hasher: PasswordHasher): void {
  currentHasher = hasher
  validateHashCost()
}

export function measureHashCost(): number {
  const start = Date.now()
  currentHasher.hash('cost-test-password')
  return Date.now() - start
}

export function getHashCostValidation(): { measured: number, minimum: number, valid: boolean } | null {
  return hashCostValidation
}

export function addLegacyHasher(hasher: PasswordHasher): void {
  legacyHashers.push(hasher)
}

function hashPassword(password: string): string {
  return currentHasher.hash(password)
}

function verifyPassword(password: string, stored: string): boolean {
  if (currentHasher.verify(password, stored)) return true
  for (const legacy of legacyHashers) {
    if (legacy.verify(password, stored)) return true
  }
  return false
}

// ===== 会话参数 =====
const SESSION_DURATION_MS = 30 * 60 * 1000 // 30 分钟

// AC-027: 可配置会话策略
export type SessionStrategy = 'allow-multi' | 'kick-previous'
let sessionStrategy: SessionStrategy = 'allow-multi'

export function setSessionStrategy(strategy: SessionStrategy): void {
  sessionStrategy = strategy
}

// ===== 可动态调整的锁定配置（默认值）=====
const DEFAULT_LOCK_THRESHOLD = 5 // AC-009 默认 5 次
const DEFAULT_LOCK_DURATION_MS = 15 * 60 * 1000 // AC-012 默认 15 分钟
const MIN_LOCK_THRESHOLD = 3 // AC-011 阈值下限 3

let lockThreshold = DEFAULT_LOCK_THRESHOLD
let lockDurationMs = DEFAULT_LOCK_DURATION_MS

// AC-005: 可配置大小写策略
export type CaseSensitivity = 'case-sensitive' | 'case-insensitive'
let caseSensitivity: CaseSensitivity = 'case-sensitive'

export function setCaseSensitivity(strategy: CaseSensitivity): void {
  caseSensitivity = strategy
}

function lookupUser(username: string): UserRecord | undefined {
  if (caseSensitivity === 'case-insensitive') {
    const lower = username.toLowerCase()
    for (const [key, user] of users) {
      if (key.toLowerCase() === lower) return user
    }
    return undefined
  }
  return users.get(username)
}

// ===== 存储（模块级，resetState 可重置）=====
let users = new Map<string, UserRecord>()
let sessions = new Map<string, SessionRecord>()
let auditLogEntries: AuditEntry[] = []

// ===== 审计辅助 =====
const AUDIT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000 // NFR-004: 90 天保留

// NFR-003: 基于 IP 的登录失败频率限制（可选增强，默认关闭）
let ipRateLimitEnabled = false
let ipRateLimitThreshold = 10
let ipRateLimitWindowMs = 60 * 1000
let ipRateLimitBanMs = 5 * 60 * 1000
let ipFailedAttempts = new Map<string, { count: number, firstAt: number, bannedUntil: number }>()

export function setIpRateLimit(opts: { enabled?: boolean, threshold?: number, windowMs?: number, banMs?: number }): void {
  if (opts.enabled !== undefined) ipRateLimitEnabled = opts.enabled
  if (opts.threshold !== undefined) ipRateLimitThreshold = opts.threshold
  if (opts.windowMs !== undefined) ipRateLimitWindowMs = opts.windowMs
  if (opts.banMs !== undefined) ipRateLimitBanMs = opts.banMs
}

function checkIpRateLimit(ip: string): boolean {
  if (!ipRateLimitEnabled) return true
  const record = ipFailedAttempts.get(ip)
  if (!record) return true
  return Date.now() >= record.bannedUntil
}

function recordIpFailure(ip: string): void {
  if (!ipRateLimitEnabled) return
  const now = Date.now()
  let record = ipFailedAttempts.get(ip)
  if (!record || now - record.firstAt > ipRateLimitWindowMs) {
    record = { count: 1, firstAt: now, bannedUntil: 0 }
  } else {
    record.count++
    if (record.count >= ipRateLimitThreshold) {
      record.bannedUntil = now + ipRateLimitBanMs
    }
  }
  ipFailedAttempts.set(ip, record)
}

function audit(username: string, ip: string, event: string, result: string): void {
  const now = Date.now()
  auditLogEntries.push({
    timestamp: now,
    username,
    ip,
    event,
    result,
  })
  // NFR-004: 清理超过保留期限的日志
  if (auditLogEntries.length > 1000) {
    const cutoff = now - AUDIT_RETENTION_MS
    auditLogEntries = auditLogEntries.filter(e => e.timestamp >= cutoff)
  }
}

// ===== 密码哈希委托给可配置 hasher =====
// hashPassword 和 verifyPassword 已在 hasher 模块中定义

// ===== 会话辅助 =====
function createSession(username: string): string {
  // AC-027: 按会话策略处理
  if (sessionStrategy === 'kick-previous') {
    for (const [token, session] of sessions) {
      if (session.username === username && !session.revoked) {
        session.revoked = true
      }
    }
  }
  const token = randomBytes(32).toString('hex')
  sessions.set(token, {
    username,
    expiresAt: Date.now() + SESSION_DURATION_MS,
    revoked: false,
  })
  return token
}

// ===== 管理员判定 =====
function isAdmin(adminUser: string): boolean {
  // 系统内置管理员账号名为 "admin"；AC-020 非管理员拒绝
  return adminUser === 'admin'
}

// ===== 公共 API =====

/**
 * 登录认证（FR-001 ~ FR-004, FR-006, FR-007）
 */
export function login(username: string, password: string, ip: string): LoginResult {
  // NFR-003: IP 频率限制检查
  if (!checkIpRateLimit(ip)) {
    audit(username ?? '', ip, 'login_failed', 'ip_rate_limited')
    return { success: false, error: '请求过于频繁，请稍后重试' }
  }
  // AC-004: 参数校验
  if (!username || !password) {
    audit(username ?? '', ip, 'login_failed', 'invalid_params')
    return { success: false, error: '用户名和密码不能为空' }
  }

  const user = lookupUser(username)

  // AC-002: 不存在的用户返回统一错误，不泄露用户名是否存在
  if (!user) {
    audit(username, ip, 'login_failed', 'not_found')
    return { success: false, error: '用户名或密码错误' }
  }

  // AC-003: 禁用账号
  if (user.disabled) {
    audit(username, ip, 'login_failed', 'disabled')
    return { success: false, error: '账号已被禁用' }
  }

  // FR-004: 锁定状态判定
  if (user.lockedAt !== undefined) {
    const duration = user.lockDurationMs ?? 0
    const isPermanent = duration === 0 // AC-012: 0 表示永久锁定
    const expired = !isPermanent && Date.now() >= user.lockedAt + duration

    if (!expired) {
      // 仍处于锁定状态：拒绝登录，失败计数不再增加（AC-010）
      if (isPermanent) {
        // AC-015: 永久锁定
        audit(username, ip, 'login_failed', 'locked_permanent')
        return { success: false, error: '账号已永久锁定，请联系管理员', remainingLockTime: -1 }
      }
      const remainingMs = user.lockedAt + duration - Date.now()
      const remainingLockTime = Math.ceil(remainingMs / 1000)
      const minutes = Math.max(1, Math.ceil(remainingLockTime / 60))
      audit(username, ip, 'login_failed', 'locked')
      return {
        success: false,
        error: `账号已锁定，请于 ${minutes} 分钟后重试`,
        remainingLockTime,
      }
    }

    // 锁定已到期：自动解锁，清零失败计数（AC-013）
    user.lockedAt = undefined
    user.lockDurationMs = undefined
    user.failedAttempts = 0
    audit(username, ip, 'auto_unlock', 'unlocked')
    // 继续向下执行密码校验
  }

  // FR-006 / AC-022: 密码校验
  if (verifyPassword(password, user.passwordHash)) {
    // 登录成功：清零失败计数与锁定状态（AC-007）
    user.failedAttempts = 0
    user.lockedAt = undefined
    user.lockDurationMs = undefined
    const token = createSession(username)
    audit(username, ip, 'login_success', 'success')
    return { success: true, token }
  }

  // AC-006 / AC-008: 密码错误，返回统一提示（不泄露哈希信息）
  user.failedAttempts += 1
  recordIpFailure(ip)
  const attempts = user.failedAttempts
  audit(username, ip, 'login_failed', `failed_attempts_${attempts}`)

  // FR-003: 达到阈值触发锁定（AC-009）
  if (attempts >= lockThreshold) {
    user.lockedAt = Date.now()
    user.lockDurationMs = lockDurationMs // 锁定时快照当前配置
    audit(username, ip, 'lock_triggered', `locked_threshold_${lockThreshold}`)
    // 注意：触发锁定的本次请求仍返回"用户名或密码错误"，
    // "后续"请求才返回锁定提示（AC-009 "后续该账号的登录请求被直接拒绝"）
  }

  return { success: false, error: '用户名或密码错误' }
}

/**
 * 获取锁定状态（FR-003, FR-004）
 * 仅读取，不触发自动解锁（自动解锁由 login 触发，AC-013）
 */
export function getLockStatus(username: string): LockStatus {
  const user = lookupUser(username)
  if (!user) {
    return { locked: false, failedAttempts: 0 }
  }
  let locked = false
  if (user.lockedAt !== undefined) {
    const duration = user.lockDurationMs ?? 0
    if (duration === 0) {
      locked = true // 永久锁定
    } else {
      // 时间感知：过期后视为未锁定（但 failedAttempts 仍保留，待 login 清零）
      locked = Date.now() < user.lockedAt + duration
    }
  }
  return {
    locked,
    failedAttempts: user.failedAttempts,
    lockedAt: user.lockedAt,
    lockDurationMs: user.lockDurationMs,
  }
}

/**
 * 管理员手动解锁（FR-005）
 */
export function adminUnlock(username: string, adminUser: string): { success: boolean, error?: string } {
  // AC-020: 权限校验
  if (!isAdmin(adminUser)) {
    return { success: false, error: '无权限' }
  }

  const user = lookupUser(username)
  // AC-018: 账号不存在
  if (!user) {
    return { success: false, error: '账号不存在' }
  }

  // AC-017 / AC-019: 解锁（幂等成功）
  const wasLocked = user.lockedAt !== undefined
  if (wasLocked) {
    user.lockedAt = undefined
    user.lockDurationMs = undefined
    user.failedAttempts = 0
  }
  audit(username, '', 'admin_unlock', wasLocked ? 'unlocked' : 'idempotent')
  return { success: true }
}

/**
 * 登出，凭证立即失效（AC-026）
 */
export function logout(token: string): boolean {
  const session = sessions.get(token)
  if (!session || session.revoked) {
    return false
  }
  session.revoked = true
  audit(session.username, '', 'logout', 'success')
  return true
}

/**
 * 验证凭证（AC-024, AC-025）
 */
export function verifyToken(token: string): { valid: boolean, expired?: boolean, error?: string } {
  const session = sessions.get(token)
  if (!session) {
    return { valid: false }
  }
  if (session.revoked) {
    return { valid: false }
  }
  if (Date.now() >= session.expiresAt) {
    // AC-025: 凭证过期
    return { valid: false, expired: true, error: '登录已过期，请重新登录' }
  }
  return { valid: true }
}

/**
 * 注册用户（测试辅助）
 */
export function registerUser(username: string, password: string, opts?: { disabled?: boolean }): void {
  users.set(username, {
    username,
    passwordHash: hashPassword(password),
    disabled: opts?.disabled ?? false,
    failedAttempts: 0,
  })
}

/**
 * 获取审计日志（NFR-004）
 */
export function getAuditLogs(username?: string): AuditEntry[] {
  if (username !== undefined) {
    return auditLogEntries.filter((log) => log.username === username)
  }
  return [...auditLogEntries]
}

/**
 * 获取密码哈希（验证存储安全性，AC-021）
 */
export function getPasswordHash(username: string): string | null {
  const user = lookupUser(username)
  if (!user) {
    return null
  }
  return user.passwordHash
}

/**
 * 动态调整锁定配置（AC-011, AC-012, NFR-003）
 * - threshold：最小值 3，低于 3 按 3 处理
 * - durationMs：0 表示永久锁定
 * 仅对新触发的锁定生效
 */
export function updateLockConfig(opts: { threshold?: number, durationMs?: number }): void {
  if (opts.threshold !== undefined) {
    lockThreshold = Math.max(MIN_LOCK_THRESHOLD, opts.threshold)
  }
  if (opts.durationMs !== undefined) {
    lockDurationMs = opts.durationMs
  }
}

/**
 * 重置全部状态（测试隔离用）
 */
export function resetState(): void {
  users = new Map()
  sessions = new Map()
  auditLogEntries = []
  lockThreshold = DEFAULT_LOCK_THRESHOLD
  lockDurationMs = DEFAULT_LOCK_DURATION_MS
  currentHasher = new ScryptHasher(100)
  legacyHashers = []
  sessionStrategy = 'allow-multi'
  caseSensitivity = 'case-sensitive'
  ipRateLimitEnabled = false
  ipFailedAttempts = new Map()
  // NFR-001: 验证并校准哈希计算开销
  validateHashCost()
}
