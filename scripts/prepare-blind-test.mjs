#!/usr/bin/env node
// prepare-blind-test.mjs — 从 project-a (V1-clean) 生成 project-b/c/d 盲测版本
// 中性目录名、中性注释、标准答案存放在独立位置

import { cpSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import os from 'node:os'

const rootDir = process.cwd()
const baseDir = resolve('blind-test')
const srcProject = resolve(baseDir, 'project-a')

// 简化测试（不含 FR-003/FR-004/FR-005 锁定相关测试）
const simplifiedTests = `import { describe, it, expect, beforeEach } from 'vitest'
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
`

function createProject(name, modifyAuth) {
  const dir = resolve(baseDir, name)
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
  cpSync(srcProject, dir, { recursive: true })
  
  if (modifyAuth) {
    let code = readFileSync(resolve(dir, 'src/auth.ts'), 'utf-8')
    code = modifyAuth(code)
    writeFileSync(resolve(dir, 'src/auth.ts'), code, 'utf-8')
  }
  
  // 用简化测试替换（缺陷版本不测锁定）
  writeFileSync(resolve(dir, 'tests/auth.test.ts'), simplifiedTests, 'utf-8')
  // 删除性能测试（简化测试中已含）
  rmSync(resolve(dir, 'tests/perf.test.ts'), { force: true })
  
  console.log(`[${name}] 完成`)
}

// === project-a 已就绪（V1-clean）===
console.log('[project-a] 已就绪（V1-clean）')

// === project-b: 完全缺失 FR-003 ===
createProject('project-b', (code) => {
  // 阈值设为不可能达到的值
  code = code.replace(
    /const DEFAULT_LOCK_THRESHOLD = 5/,
    'const DEFAULT_LOCK_THRESHOLD = 999999'
  )
  // 删除锁定触发逻辑
  code = code.replace(
    /\n\s*if \(attempts >= lockThreshold\) \{[\s\S]*?\}\s*\n/,
    '\n'
  )
  // getLockStatus 始终返回未锁定
  code = code.replace(
    /export function getLockStatus[\s\S]*?^}/m,
    `export function getLockStatus(username: string): LockStatus {
  const user = users.get(username)
  return { locked: false, failedAttempts: user ? user.failedAttempts : 0 }
}`
  )
  // updateLockConfig 改为空操作
  code = code.replace(
    /export function updateLockConfig[\s\S]*?^}/m,
    `export function updateLockConfig(opts: { threshold?: number, durationMs?: number }): void {
  // 配置更新接口存在
}`
  )
  return code
})

// === project-c: 部分实现 FR-003（保留接口删除触发逻辑）===
createProject('project-c', (code) => {
  // 只删除锁定触发的 if 块
  code = code.replace(
    /\n\s*if \(attempts >= lockThreshold\) \{[\s\S]*?\}\s*\n/,
    '\n'
  )
  return code
})

// === project-d: 行为矛盾（阈值 5 改 10）===
createProject('project-d', (code) => {
  code = code.replace(
    /const DEFAULT_LOCK_THRESHOLD = 5/,
    'const DEFAULT_LOCK_THRESHOLD = 10'
  )
  return code
})

// === 标准答案（存放在工作区外部，Reviewer 无法访问）===
const answersDir = resolve(os.homedir(), 'AppData/Local/Temp/opencode/blind-test-answers')
mkdirSync(answersDir, { recursive: true })

const answers = {
  createdAt: new Date().toISOString(),
  note: '此文件仅供验收核对，Reviewer Agent 无法访问',
  versions: {
    'project-a': {
      description: '完整实现，所有需求正确',
      fullyImplemented: true,
      expectedGaps: []
    },
    'project-b': {
      description: '删除锁定触发逻辑，阈值设为极大值，getLockStatus 始终返回未锁定',
      fullyImplemented: false,
      expectedGaps: [
        { id: 'FR-003', expectedStatus: 'missing', location: 'src/auth.ts', detail: '阈值=999999，锁定触发 if 块被删除，getLockStatus 始终 false' },
        { id: 'FR-004', expectedStatus: 'missing_or_unverified', location: 'src/auth.ts', detail: '锁定判定逻辑存在但不可达（lockedAt 永远不会被设置）' },
        { id: 'FR-005', expectedStatus: 'partial_or_pass', location: 'src/auth.ts', detail: 'adminUnlock 接口存在但无实际锁定状态可解除，依赖链断裂' },
        { id: 'NFR-003', expectedStatus: 'missing_or_partial', location: 'src/auth.ts', detail: '防暴力破解依赖 FR-003，updateLockConfig 为空操作' },
        { id: 'NFR-004', expectedStatus: 'partial', location: 'src/auth.ts', detail: '缺少 lock_triggered 审计事件' }
      ]
    },
    'project-c': {
      description: '保留锁定接口和配置，但删除实际锁定触发逻辑',
      fullyImplemented: false,
      expectedGaps: [
        { id: 'FR-003', expectedStatus: 'partial', location: 'src/auth.ts', detail: 'failedAttempts 递增但不检查阈值，不设置 lockedAt' },
        { id: 'FR-004', expectedStatus: 'partial_or_unverified', location: 'src/auth.ts', detail: '判定逻辑存在但依赖 FR-003 触发，不可达' },
        { id: 'NFR-003', expectedStatus: 'partial', location: 'src/auth.ts', detail: 'updateLockConfig 有效但锁定触发缺失' },
        { id: 'NFR-004', expectedStatus: 'partial', location: 'src/auth.ts', detail: '缺少 lock_triggered 审计事件' }
      ]
    },
    'project-d': {
      description: '锁定阈值从 5 改为 10',
      fullyImplemented: false,
      expectedGaps: [
        { id: 'FR-003', expectedStatus: 'contradicts', location: 'src/auth.ts', detail: 'DEFAULT_LOCK_THRESHOLD=10，Spec 要求 5 次' }
      ]
    }
  }
}

writeFileSync(resolve(answersDir, 'standard-answers.json'), JSON.stringify(answers, null, 2) + '\n', 'utf-8')

console.log('\n盲测环境准备完成:')
console.log('  project-a: 完整实现 (V1-clean)')
console.log('  project-b: 缺陷版本 1')
console.log('  project-c: 缺陷版本 2')
console.log('  project-d: 缺陷版本 3')
console.log(`  标准答案: ${resolve(answersDir, 'standard-answers.json')}`)
