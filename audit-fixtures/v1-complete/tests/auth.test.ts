import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  login,
  getLockStatus,
  adminUnlock,
  logout,
  verifyToken,
  registerUser,
  getAuditLogs,
  getPasswordHash,
  updateLockConfig,
  resetState,
  type LoginResult,
} from '../src/auth'

const IP = '192.168.1.100'
const ADMIN = 'admin'

beforeEach(() => {
  resetState()
})

afterEach(() => {
  vi.useRealTimers()
})

// ===== FR-001: 账号密码登录 =====
describe('FR-001 账号密码登录', () => {
  it('AC-001 正确用户名密码登录成功，返回有效 token', () => {
    registerUser('alice', 'Passw0rd!')
    const res = login('alice', 'Passw0rd!', IP)
    expect(res.success).toBe(true)
    expect(res.token).toBeTruthy()
    // token 有效
    expect(verifyToken(res.token!).valid).toBe(true)
  })

  it('AC-002 不存在的用户名返回统一错误，不泄露存在性', () => {
    const res = login('ghost', 'whatever', IP)
    expect(res.success).toBe(false)
    expect(res.error).toBe('用户名或密码错误')
    expect(res.error).not.toContain('不存在')
  })

  it('AC-003 禁用账号返回"账号已被禁用"', () => {
    registerUser('bob', 'Passw0rd!', { disabled: true })
    const res = login('bob', 'Passw0rd!', IP)
    expect(res.success).toBe(false)
    expect(res.error).toBe('账号已被禁用')
  })

  it('AC-004 用户名或密码为空返回参数校验提示', () => {
    expect(login('', 'pw', IP).error).toBe('用户名和密码不能为空')
    expect(login('user', '', IP).error).toBe('用户名和密码不能为空')
    expect(login('', '', IP).error).toBe('用户名和密码不能为空')
  })

  it('AC-005 大小写敏感：大小写不一致登录失败', () => {
    registerUser('Alice', 'Passw0rd!')
    const res = login('alice', 'Passw0rd!', IP)
    expect(res.success).toBe(false)
    expect(res.error).toBe('用户名或密码错误')
  })
})

// ===== FR-002: 密码错误处理 =====
describe('FR-002 密码错误处理', () => {
  it('AC-006 错误密码拒绝并累计失败次数', () => {
    registerUser('carol', 'Passw0rd!')
    const res = login('carol', 'wrong', IP)
    expect(res.success).toBe(false)
    expect(res.error).toBe('用户名或密码错误')
    expect(getLockStatus('carol').failedAttempts).toBe(1)
  })

  it('AC-007 失败后立即正确密码登录成功，计数清零', () => {
    registerUser('dave', 'Passw0rd!')
    login('dave', 'wrong', IP)
    expect(getLockStatus('dave').failedAttempts).toBe(1)
    const res = login('dave', 'Passw0rd!', IP)
    expect(res.success).toBe(true)
    expect(getLockStatus('dave').failedAttempts).toBe(0)
  })

  it('AC-008 密码错误不返回哈希相关信息', () => {
    registerUser('eve', 'Passw0rd!')
    const res = login('eve', 'wrong', IP)
    expect(res.error).toBe('用户名或密码错误')
    expect(res.error).not.toMatch(/hash|scrypt|salt|bcrypt/i)
  })
})

// ===== FR-003: 失败次数累计与账号锁定 =====
describe('FR-003 失败次数累计与账号锁定', () => {
  it('AC-009 达到默认阈值 5 次后锁定，后续请求返回锁定提示', () => {
    registerUser('frank', 'Passw0rd!')
    // 5 次失败（第 5 次触发锁定但返回标准错误）
    for (let i = 0; i < 5; i++) {
      const r = login('frank', 'wrong', IP)
      expect(r.error).toBe('用户名或密码错误')
    }
    // 锁定状态
    expect(getLockStatus('frank').locked).toBe(true)
    // 第 6 次请求返回锁定提示
    const res = login('frank', 'Passw0rd!', IP)
    expect(res.success).toBe(false)
    expect(res.error).toContain('锁定')
    expect(res.remainingLockTime).toBeGreaterThan(0)
  })

  it('AC-010 锁定期间即使正确密码也拒绝，失败计数不增加', () => {
    registerUser('grace', 'Passw0rd!')
    updateLockConfig({ threshold: 3 })
    for (let i = 0; i < 3; i++) login('grace', 'wrong', IP)
    expect(getLockStatus('grace').failedAttempts).toBe(3)
    // 正确密码仍被拒绝
    const res = login('grace', 'Passw0rd!', IP)
    expect(res.success).toBe(false)
    expect(res.error).toContain('锁定')
    // 计数未增加
    expect(getLockStatus('grace').failedAttempts).toBe(3)
  })

  it('AC-011 阈值可配置，最小值 3（低于 3 按 3）', () => {
    // 设为 3
    updateLockConfig({ threshold: 3 })
    registerUser('henry', 'Passw0rd!')
    for (let i = 0; i < 3; i++) login('henry', 'wrong', IP)
    expect(getLockStatus('henry').locked).toBe(true)

    resetState()
    // 设为 2，实际取 3
    updateLockConfig({ threshold: 2 })
    registerUser('ivy', 'Passw0rd!')
    login('ivy', 'wrong', IP)
    login('ivy', 'wrong', IP)
    // 仅 2 次未达阈值 3
    expect(getLockStatus('ivy').locked).toBe(false)
    login('ivy', 'wrong', IP)
    expect(getLockStatus('ivy').locked).toBe(true)
  })

  it('AC-012 锁定时长可配置，0 表示永久锁定', () => {
    updateLockConfig({ threshold: 3, durationMs: 0 })
    registerUser('jack', 'Passw0rd!')
    for (let i = 0; i < 3; i++) login('jack', 'wrong', IP)
    expect(getLockStatus('jack').locked).toBe(true)
    // 即使经过很长时间仍锁定（用假定时钟验证）
    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + 365 * 24 * 60 * 60 * 1000)
    expect(getLockStatus('jack').locked).toBe(true)
    const res = login('jack', 'Passw0rd!', IP)
    expect(res.success).toBe(false)
    expect(res.remainingLockTime).toBe(-1)
  })
})

// ===== FR-004: 锁定状态判定与恢复 =====
describe('FR-004 锁定状态判定与恢复', () => {
  it('AC-013 锁定到期后下一次登录触发自动解锁，计数清零', () => {
    updateLockConfig({ threshold: 3, durationMs: 1000 }) // 1 秒
    registerUser('kate', 'Passw0rd!')
    for (let i = 0; i < 3; i++) login('kate', 'wrong', IP)
    expect(getLockStatus('kate').locked).toBe(true)

    vi.useFakeTimers()
    vi.advanceTimersByTime(1100) // 过期

    // 无论密码正确与否都触发解锁
    const res = login('kate', 'wrong', IP)
    // 解锁后走密码校验，密码错误返回标准错误（不再是锁定提示）
    expect(res.error).toBe('用户名或密码错误')
    expect(getLockStatus('kate').locked).toBe(false)
    expect(getLockStatus('kate').failedAttempts).toBe(1) // 解锁后这次失败 +1
  })

  it('AC-014 边界：不足时长仍锁定，满 1 倍时长解锁', () => {
    updateLockConfig({ threshold: 3, durationMs: 1000 })
    registerUser('leo', 'Passw0rd!')
    for (let i = 0; i < 3; i++) login('leo', 'wrong', IP)

    vi.useFakeTimers()
    // 不足 1 倍（999ms）仍锁定
    vi.advanceTimersByTime(999)
    expect(getLockStatus('leo').locked).toBe(true)
    const lockedRes = login('leo', 'Passw0rd!', IP)
    expect(lockedRes.error).toContain('锁定')

    // 满 1 倍（+1ms）解锁
    vi.advanceTimersByTime(1)
    const res = login('leo', 'Passw0rd!', IP)
    expect(res.success).toBe(true)
    expect(getLockStatus('leo').locked).toBe(false)
  })

  it('AC-015 永久锁定经任意时长仍锁定，仅管理员可恢复', () => {
    updateLockConfig({ threshold: 3, durationMs: 0 })
    registerUser('mona', 'Passw0rd!')
    for (let i = 0; i < 3; i++) login('mona', 'wrong', IP)

    vi.useFakeTimers()
    vi.advanceTimersByTime(365 * 24 * 60 * 60 * 1000)
    expect(getLockStatus('mona').locked).toBe(true)

    // 管理员解锁
    const unlock = adminUnlock('mona', ADMIN)
    expect(unlock.success).toBe(true)
    expect(getLockStatus('mona').locked).toBe(false)
    expect(getLockStatus('mona').failedAttempts).toBe(0)
  })

  it('AC-016 多次锁定周期独立，时长不叠加', () => {
    updateLockConfig({ threshold: 3, durationMs: 1000 })
    registerUser('nina', 'Passw0rd!')

    // 第一次锁定
    for (let i = 0; i < 3; i++) login('nina', 'wrong', IP)
    const lock1 = getLockStatus('nina').lockedAt!

    vi.useFakeTimers()
    vi.advanceTimersByTime(1100) // 过期解锁
    login('nina', 'Passw0rd!', IP) // 触发自动解锁 + 登录成功
    expect(getLockStatus('nina').locked).toBe(false)

    // 再次失败到锁定
    vi.useRealTimers()
    for (let i = 0; i < 3; i++) login('nina', 'wrong', IP)
    const lock2 = getLockStatus('nina').lockedAt!

    // 两次 lockedAt 不同，lockDurationMs 相同（不叠加）
    expect(lock2).toBeGreaterThan(lock1)
    expect(getLockStatus('nina').lockDurationMs).toBe(1000)
  })
})

// ===== FR-005: 管理员手动解锁 =====
describe('FR-005 管理员手动解锁', () => {
  it('AC-017 管理员解锁已锁定账号，立即恢复', () => {
    registerUser('oscar', 'Passw0rd!')
    updateLockConfig({ threshold: 3 })
    for (let i = 0; i < 3; i++) login('oscar', 'wrong', IP)
    expect(getLockStatus('oscar').locked).toBe(true)

    const res = adminUnlock('oscar', ADMIN)
    expect(res.success).toBe(true)
    expect(getLockStatus('oscar').locked).toBe(false)
    expect(getLockStatus('oscar').failedAttempts).toBe(0)
    // 现在可以正常登录
    const loginRes = login('oscar', 'Passw0rd!', IP)
    expect(loginRes.success).toBe(true)
  })

  it('AC-018 解锁不存在的账号返回"账号不存在"', () => {
    const res = adminUnlock('nobody', ADMIN)
    expect(res.success).toBe(false)
    expect(res.error).toBe('账号不存在')
  })

  it('AC-019 对未锁定账号解锁幂等成功，状态不变', () => {
    registerUser('penny', 'Passw0rd!')
    const before = getLockStatus('penny')
    const res = adminUnlock('penny', ADMIN)
    expect(res.success).toBe(true)
    const after = getLockStatus('penny')
    expect(after.locked).toBe(false)
    expect(after.failedAttempts).toBe(before.failedAttempts)
  })

  it('AC-020 非管理员调用返回"无权限"', () => {
    registerUser('quinn', 'Passw0rd!')
    const res = adminUnlock('quinn', 'notadmin')
    expect(res.success).toBe(false)
    expect(res.error).toBe('无权限')
  })
})

// ===== FR-006: 密码安全存储与校验 =====
describe('FR-006 密码安全存储与校验', () => {
  it('AC-021 存储为哈希值不含明文，相同明文不同盐不同哈希', () => {
    registerUser('r1', 'samepassword')
    registerUser('r2', 'samepassword')
    const h1 = getPasswordHash('r1')
    const h2 = getPasswordHash('r2')
    expect(h1).not.toBeNull()
    expect(h2).not.toBeNull()
    // 不含明文
    expect(h1).not.toContain('samepassword')
    expect(h2).not.toContain('samepassword')
    // 不同盐 → 不同哈希
    expect(h1).not.toBe(h2)
    // 都是 scrypt 格式
    expect(h1!.startsWith('scrypt$')).toBe(true)
    expect(h2!.startsWith('scrypt$')).toBe(true)
  })

  it('AC-022 输入密码经哈希比对，正确即视为密码正确', () => {
    registerUser('steve', 'MySecret123')
    expect(login('steve', 'MySecret123', IP).success).toBe(true)
    expect(login('steve', 'wrong', IP).success).toBe(false)
  })
})

// ===== FR-007: 登录会话与凭证管理 =====
describe('FR-007 登录会话与凭证管理', () => {
  it('AC-024 凭证过期前有效', () => {
    registerUser('tom', 'Passw0rd!')
    const { token } = login('tom', 'Passw0rd!', IP)
    expect(verifyToken(token!).valid).toBe(true)
  })

  it('AC-025 凭证过期后失效', () => {
    registerUser('ulysses', 'Passw0rd!')
    const { token } = login('ulysses', 'Passw0rd!', IP)
    vi.useFakeTimers()
    // 默认 30 分钟，前进 31 分钟
    vi.advanceTimersByTime(31 * 60 * 1000)
    const res = verifyToken(token!)
    expect(res.valid).toBe(false)
    expect(res.expired).toBe(true)
  })

  it('AC-026 登出后凭证立即失效', () => {
    registerUser('victor', 'Passw0rd!')
    const { token } = login('victor', 'Passw0rd!', IP)
    expect(verifyToken(token!).valid).toBe(true)
    expect(logout(token!)).toBe(true)
    expect(verifyToken(token!).valid).toBe(false)
    // 重复登出返回 false
    expect(logout(token!)).toBe(false)
  })

  it('AC-027 多设备并发登录允许多会话', () => {
    registerUser('wendy', 'Passw0rd!')
    const r1 = login('wendy', 'Passw0rd!', 'ip1')
    const r2 = login('wendy', 'Passw0rd!', 'ip2')
    expect(r1.success).toBe(true)
    expect(r2.success).toBe(true)
    // 两个 token 都有效
    expect(verifyToken(r1.token!).valid).toBe(true)
    expect(verifyToken(r2.token!).valid).toBe(true)
  })
})

// ===== NFR-001: 密码存储安全性 =====
describe('NFR-001 密码存储安全性', () => {
  it('使用带盐慢哈希，非明文/非无盐哈希', () => {
    registerUser('x1', 'Passw0rd!')
    const hash = getPasswordHash('x1')!
    expect(hash.startsWith('scrypt$')).toBe(true)
    // 不含明文
    expect(hash).not.toContain('Passw0rd!')
    // 不含裸 MD5/SHA1
    expect(hash).not.toMatch(/^\$md5\$/i)
    expect(hash.length).toBeGreaterThan(32)
  })
})

// ===== NFR-003: 动态调整锁定参数 =====
describe('NFR-003 锁定参数动态调整', () => {
  it('updateLockConfig 可在运行时调整阈值和时长', () => {
    updateLockConfig({ threshold: 4, durationMs: 5000 })
    registerUser('y1', 'Passw0rd!')
    for (let i = 0; i < 4; i++) login('y1', 'wrong', IP)
    expect(getLockStatus('y1').locked).toBe(true)
    expect(getLockStatus('y1').lockDurationMs).toBe(5000)
  })
})

// ===== NFR-004: 审计日志 =====
describe('NFR-004 审计日志', () => {
  it('登录成功/失败均记录审计日志，含来源 IP', () => {
    registerUser('z1', 'Passw0rd!')
    login('z1', 'Passw0rd!', IP)
    login('z1', 'wrong', IP)

    const logs = getAuditLogs('z1')
    expect(logs.some((l) => l.event === 'login_success' && l.ip === IP)).toBe(true)
    expect(logs.some((l) => l.event === 'login_failed' && l.ip === IP)).toBe(true)
    // 所有日志都有 IP 字段
    expect(logs.every((l) => typeof l.ip === 'string')).toBe(true)
  })

  it('账号锁定触发与自动解锁记录审计', () => {
    updateLockConfig({ threshold: 3, durationMs: 1000 })
    registerUser('z2', 'Passw0rd!')
    for (let i = 0; i < 3; i++) login('z2', 'wrong', IP)

    const logs = getAuditLogs('z2')
    expect(logs.some((l) => l.event === 'lock_triggered')).toBe(true)

    vi.useFakeTimers()
    vi.advanceTimersByTime(1100)
    login('z2', 'Passw0rd!', IP) // 触发自动解锁

    const logs2 = getAuditLogs('z2')
    expect(logs2.some((l) => l.event === 'auto_unlock')).toBe(true)
    expect(logs2.some((l) => l.event === 'login_success')).toBe(true)
  })

  it('管理员解锁与登出记录审计', () => {
    registerUser('z3', 'Passw0rd!')
    updateLockConfig({ threshold: 3 })
    for (let i = 0; i < 3; i++) login('z3', 'wrong', IP)
    adminUnlock('z3', ADMIN)

    expect(getAuditLogs('z3').some((l) => l.event === 'admin_unlock')).toBe(true)

    const { token } = login('z3', 'Passw0rd!', IP)
    logout(token!)
    expect(getAuditLogs('z3').some((l) => l.event === 'logout')).toBe(true)
  })

  it('登录失败审计含失败次数', () => {
    registerUser('z4', 'Passw0rd!')
    login('z4', 'wrong', IP)
    login('z4', 'wrong', IP)
    const logs = getAuditLogs('z4').filter((l) => l.event === 'login_failed')
    expect(logs.length).toBeGreaterThanOrEqual(2)
    // result 含失败次数
    expect(logs[0].result).toMatch(/\d/)
  })

  it('getAuditLogs 不传参返回全部', () => {
    registerUser('z5', 'Passw0rd!')
    registerUser('z6', 'Passw0rd!')
    login('z5', 'Passw0rd!', IP)
    login('z6', 'wrong', IP)
    const all = getAuditLogs()
    expect(all.length).toBeGreaterThanOrEqual(2)
  })
})

// ===== NFR-005: 错误提示安全性 =====
describe('NFR-005 错误提示安全性', () => {
  it('所有错误提示不泄露内部信息', () => {
    registerUser('w1', 'Passw0rd!')
    const errors = [
      login('w1', 'wrong', IP).error!,
      login('ghost', 'pw', IP).error!,
      login('', '', IP).error!,
    ]
    for (const msg of errors) {
      expect(msg).not.toMatch(/hash|scrypt|salt|bcrypt|sql|database|stack|argon/i)
      expect(msg).not.toContain('Passw0rd!')
    }
  })
})
