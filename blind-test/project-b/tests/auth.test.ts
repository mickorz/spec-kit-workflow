import { describe, it, expect, beforeEach } from 'vitest'
import { login, registerUser, resetState, getAuditLogs, verifyToken, logout, getPasswordHash } from '../src/auth'

beforeEach(() => {
  resetState()
  registerUser('alice', 'Pass1234!')
  registerUser('bob', 'Secret456@')
})

describe('登录功能', () => {
  it('正确密码登录成功', () => {
    const res = login('alice', 'Pass1234!', '192.168.1.1')
    expect(res.success).toBe(true)
    expect(res.token).toBeTruthy()
  })
  it('不存在的用户返回统一错误', () => {
    const res = login('nobody', 'Pass1234!', '192.168.1.1')
    expect(res.success).toBe(false)
    expect(res.error).toContain('用户名或密码错误')
  })
  it('参数为空返回校验提示', () => {
    const res = login('', '', '192.168.1.1')
    expect(res.success).toBe(false)
    expect(res.error).toContain('不能为空')
  })
  it('大小写敏感', () => {
    const res = login('Alice', 'Pass1234!', '192.168.1.1')
    expect(res.success).toBe(false)
  })
  it('错误密码拒绝', () => {
    const res = login('alice', 'wrong', '192.168.1.1')
    expect(res.success).toBe(false)
  })
  it('失败后正确密码登录成功', () => {
    login('alice', 'wrong', '192.168.1.1')
    const res = login('alice', 'Pass1234!', '192.168.1.1')
    expect(res.success).toBe(true)
  })
  it('错误提示不含哈希信息', () => {
    const res = login('alice', 'wrong', '192.168.1.1')
    expect(res.error).not.toMatch(/scrypt|hash|salt/i)
  })
})

describe('密码安全存储', () => {
  it('存储为哈希不含明文', () => {
    const hash = getPasswordHash('alice')
    expect(hash).toBeTruthy()
    expect(hash).not.toContain('Pass1234')
  })
  it('相同密码不同盐不同哈希', () => {
    expect(getPasswordHash('alice')).not.toBe(getPasswordHash('bob'))
  })
})

describe('会话与凭证管理', () => {
  it('凭证过期前有效', () => {
    const res = login('alice', 'Pass1234!', '192.168.1.1')
    expect(verifyToken(res.token!).valid).toBe(true)
  })
  it('登出后凭证失效', () => {
    const res = login('alice', 'Pass1234!', '192.168.1.1')
    expect(logout(res.token!)).toBe(true)
    expect(verifyToken(res.token!).valid).toBe(false)
  })
  it('多设备并发允许多会话', () => {
    const r1 = login('alice', 'Pass1234!', '192.168.1.1')
    const r2 = login('alice', 'Pass1234!', '192.168.1.2')
    expect(r1.success).toBe(true)
    expect(r2.success).toBe(true)
    expect(r1.token).not.toBe(r2.token)
  })
})

describe('审计日志', () => {
  it('登录成功失败记录审计日志含来源IP', () => {
    login('alice', 'Pass1234!', '10.0.0.1')
    login('alice', 'wrong', '10.0.0.2')
    const logs = getAuditLogs('alice')
    expect(logs.length).toBeGreaterThanOrEqual(2)
    expect(logs.some(l => l.ip === '10.0.0.1')).toBe(true)
    expect(logs.some(l => l.ip === '10.0.0.2')).toBe(true)
  })
})

describe('性能', () => {
  it('95分位响应时间不超过500ms', () => {
    const samples = []
    for (let i = 0; i < 20; i++) {
      const s = performance.now()
      login('alice', 'Pass1234!', '127.0.0.1')
      samples.push(performance.now() - s)
    }
    samples.sort((a, b) => a - b)
    expect(samples[Math.floor(samples.length * 0.95)]).toBeLessThan(500)
  })
})
