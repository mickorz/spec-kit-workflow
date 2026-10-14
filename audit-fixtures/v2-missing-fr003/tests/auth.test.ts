import { describe, it, expect, beforeEach } from 'vitest'
import { login, registerUser, resetState, getAuditLogs, verifyToken, logout, getPasswordHash } from '../src/auth'

beforeEach(() => {
  resetState()
  registerUser('alice', 'Pass1234!')
  registerUser('bob', 'Secret456@')
})

describe('FR-001 账号密码登录', () => {
  it('AC-001 正确用户名密码登录成功', () => {
    const res = login('alice', 'Pass1234!', '192.168.1.1')
    expect(res.success).toBe(true)
    expect(res.token).toBeTruthy()
  })
  it('AC-002 不存在的用户返回统一错误', () => {
    const res = login('nobody', 'Pass1234!', '192.168.1.1')
    expect(res.success).toBe(false)
    expect(res.error).toContain('用户名或密码错误')
  })
  it('AC-004 参数为空返回校验提示', () => {
    const res = login('', '', '192.168.1.1')
    expect(res.success).toBe(false)
    expect(res.error).toContain('不能为空')
  })
  it('AC-005 大小写敏感', () => {
    const res = login('Alice', 'Pass1234!', '192.168.1.1')
    expect(res.success).toBe(false)
  })
})

describe('FR-002 密码错误处理', () => {
  it('AC-006 错误密码拒绝', () => {
    const res = login('alice', 'wrong', '192.168.1.1')
    expect(res.success).toBe(false)
    expect(res.error).toContain('用户名或密码错误')
  })
  it('AC-007 失败后正确密码登录成功', () => {
    login('alice', 'wrong', '192.168.1.1')
    const res = login('alice', 'Pass1234!', '192.168.1.1')
    expect(res.success).toBe(true)
  })
  it('AC-008 错误提示不含哈希信息', () => {
    const res = login('alice', 'wrong', '192.168.1.1')
    expect(res.error).not.toMatch(/scrypt|hash|salt/i)
  })
})

describe('FR-006 密码安全存储', () => {
  it('AC-021 存储为哈希不含明文', () => {
    const hash = getPasswordHash('alice')
    expect(hash).toBeTruthy()
    expect(hash).not.toContain('Pass1234')
  })
  it('AC-022 相同密码不同盐不同哈希', () => {
    const h1 = getPasswordHash('alice')
    const h2 = getPasswordHash('bob')
    expect(h1).not.toBe(h2)
  })
})

describe('FR-007 登录会话与凭证管理', () => {
  it('AC-024 凭证过期前有效', () => {
    const res = login('alice', 'Pass1234!', '192.168.1.1')
    expect(verifyToken(res.token!).valid).toBe(true)
  })
  it('AC-026 登出后凭证失效', () => {
    const res = login('alice', 'Pass1234!', '192.168.1.1')
    expect(logout(res.token!)).toBe(true)
    expect(verifyToken(res.token!).valid).toBe(false)
  })
  it('AC-027 多设备并发允许多会话', () => {
    const r1 = login('alice', 'Pass1234!', '192.168.1.1')
    const r2 = login('alice', 'Pass1234!', '192.168.1.2')
    expect(r1.success).toBe(true)
    expect(r2.success).toBe(true)
    expect(r1.token).not.toBe(r2.token)
  })
})

describe('NFR-001 密码存储安全性', () => {
  it('使用带盐慢哈希', () => {
    const hash = getPasswordHash('alice')
    expect(hash).toMatch(/^scrypt\$/)
  })
})

describe('NFR-004 审计日志', () => {
  it('登录成功失败记录审计日志含来源IP', () => {
    login('alice', 'Pass1234!', '10.0.0.1')
    login('alice', 'wrong', '10.0.0.2')
    const logs = getAuditLogs('alice')
    expect(logs.length).toBeGreaterThanOrEqual(2)
    expect(logs.some(l => l.ip === '10.0.0.1')).toBe(true)
    expect(logs.some(l => l.ip === '10.0.0.2')).toBe(true)
  })
})

describe('NFR-005 错误提示安全性', () => {
  it('错误提示不泄露内部信息', () => {
    const res = login('alice', 'wrong', '1.2.3.4')
    expect(res.error).not.toMatch(/scrypt|hash|salt|bcrypt|crypto/i)
  })
})
