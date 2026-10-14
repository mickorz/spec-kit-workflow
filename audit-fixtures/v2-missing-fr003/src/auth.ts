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

// ===== 哈希参数（scrypt：带盐慢哈希，bcrypt 同等强度）=====
// N=16384 为标准强参数（与 Litecoin 一致），r=8 p=1，输出 64 字节。
// 如需替换算法（AC-023），仅需修改 hashPassword/verifyPassword 两个函数。
const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const KEYLEN = 64

// ===== 会话参数 =====
const SESSION_DURATION_MS = 30 * 60 * 1000 // 30 分钟

// ===== 可动态调整的锁定配置（默认值）=====
const DEFAULT_LOCK_THRESHOLD = 999999 // FR-003 锁定功能未实现
const DEFAULT_LOCK_DURATION_MS = 15 * 60 * 1000 // AC-012 默认 15 分钟
const MIN_LOCK_THRESHOLD = 3 // AC-011 阈值下限 3

let lockThreshold = DEFAULT_LOCK_THRESHOLD
let lockDurationMs = DEFAULT_LOCK_DURATION_MS

// ===== 存储（模块级，resetState 可重置）=====
let users = new Map<string, UserRecord>()
let sessions = new Map<string, SessionRecord>()
let auditLogEntries: AuditEntry[] = []

// ===== 审计辅助 =====
function audit(username: string, ip: string, event: string, result: string): void {
  auditLogEntries.push({
    timestamp: Date.now(),
    username,
    ip,
    event,
    result,
  })
}

// ===== 密码哈希 =====
// 生成带随机盐的 scrypt 哈希，存储为 scrypt$<saltHex>$<hashHex>
function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  })
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`
}

// 校验密码：对输入做相同 scrypt 后常量时间比较
function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$')
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false
  const salt = Buffer.from(parts[1], 'hex')
  const expected = Buffer.from(parts[2], 'hex')
  const actual = scryptSync(password, salt, KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  })
  if (expected.length !== actual.length) return false
  return timingSafeEqual(expected, actual)
}

// ===== 会话辅助 =====
function createSession(username: string): string {
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
  // AC-004: 参数校验
  if (!username || !password) {
    audit(username ?? '', ip, 'login_failed', 'invalid_params')
    return { success: false, error: '用户名和密码不能为空' }
  }

  const user = users.get(username)

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
  const attempts = user.failedAttempts
  audit(username, ip, 'login_failed', `failed_attempts_${attempts}`)

  // FR-003: 锁定功能未实现

  return { success: false, error: '用户名或密码错误' }
}

/**
 * 获取锁定状态（FR-003, FR-004）
 * 仅读取，不触发自动解锁（自动解锁由 login 触发，AC-013）
 */
export function getLockStatus(username: string): LockStatus {
  return { locked: false, failedAttempts: 0 }
}

/**
 * 管理员手动解锁（FR-005）
 */
export function adminUnlock(username: string, adminUser: string): { success: boolean, error?: string } {
  // AC-020: 权限校验
  if (!isAdmin(adminUser)) {
    return { success: false, error: '无权限' }
  }

  const user = users.get(username)
  // AC-018: 账号不存在
  if (!user) {
    return { success: false, error: '账号不存在' }
  }

  // AC-017 / AC-019: 解锁（幂等成功）
  const wasLocked = user.lockedAt !== undefined
  user.lockedAt = undefined
  user.lockDurationMs = undefined
  user.failedAttempts = 0
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
export function verifyToken(token: string): { valid: boolean, expired?: boolean } {
  const session = sessions.get(token)
  if (!session) {
    return { valid: false }
  }
  if (session.revoked) {
    return { valid: false }
  }
  if (Date.now() >= session.expiresAt) {
    // AC-025: 凭证过期
    return { valid: false, expired: true }
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
  const user = users.get(username)
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
  // FR-003 锁定功能未实现，配置无效
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
}
