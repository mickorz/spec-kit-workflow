#!/usr/bin/env node
// prepare-audit-fixtures.mjs — 准备 V1-V4 受控缺陷版本
// V1: 完整实现（A0-01 基线）
// V2: 删除 FR-003 锁定逻辑（missing）
// V3: 保留接口删除内部锁定逻辑（partial）
// V4: 阈值 5 改 10（contradicts）
// V2-V4 使用简化测试（不含锁定测试），确保测试全通过

import { cpSync, mkdirSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

const rootDir = process.cwd()
const srcDir = resolve('experiments/runs/A0-01/app')
const fixtureDir = resolve('audit-fixtures')

// 清理旧目录
if (existsSync(fixtureDir)) {
  rmSync(fixtureDir, { recursive: true, force: true })
}
mkdirSync(fixtureDir, { recursive: true })

// === 简化测试文件（不含 FR-003/FR-004/FR-005 锁定相关测试）===
const simplifiedTests = `import { describe, it, expect, beforeEach } from 'vitest'
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
    expect(hash).toMatch(/^scrypt\\$/)
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
`

// === 创建 V1（完整实现）===
console.log('[V1] 创建完整实现版本...')
const v1Dir = resolve(fixtureDir, 'v1-complete')
cpSync(srcDir, v1Dir, { recursive: true })
// 删除隐藏验收测试（不属于工程自有测试）
rmSync(resolve(v1Dir, 'tests/hidden-acceptance.test.ts'), { force: true })
console.log('[V1] 完成')

// === 创建 V2（完全删除 FR-003 锁定逻辑）===
console.log('[V2] 创建 missing 版本（删除锁定逻辑）...')
const v2Dir = resolve(fixtureDir, 'v2-missing-fr003')
cpSync(srcDir, v2Dir, { recursive: true })
rmSync(resolve(v2Dir, 'tests/hidden-acceptance.test.ts'), { force: true })

// 读取 auth.ts 并删除锁定相关代码
let v2Code = readFileSync(resolve(v2Dir, 'src/auth.ts'), 'utf-8')
// 删除锁定阈值常量和配置
v2Code = v2Code.replace(/const DEFAULT_LOCK_THRESHOLD = 5.*\n/, 'const DEFAULT_LOCK_THRESHOLD = 999999 // FR-003 锁定功能未实现\n')
v2Code = v2Code.replace(/let lockThreshold = DEFAULT_LOCK_THRESHOLD\nlet lockDurationMs = DEFAULT_LOCK_DURATION_MS/, 'let lockThreshold = DEFAULT_LOCK_THRESHOLD\nlet lockDurationMs = DEFAULT_LOCK_DURATION_MS')
// 删除锁定触发逻辑（login 函数中）
v2Code = v2Code.replace(
  /\/\/ FR-003: 达到阈值触发锁定[\s\S]*?\n  \}\n/,
  '// FR-003: 锁定功能未实现\n'
)
// getLockStatus 始终返回未锁定
v2Code = v2Code.replace(
  /export function getLockStatus[\s\S]*?^}/m,
  `export function getLockStatus(username: string): LockStatus {
  return { locked: false, failedAttempts: 0 }
}`
)
// updateLockConfig 改为空操作
v2Code = v2Code.replace(
  /export function updateLockConfig[\s\S]*?^}/m,
  `export function updateLockConfig(opts: { threshold?: number, durationMs?: number }): void {
  // FR-003 锁定功能未实现，配置无效
}`
)
writeFileSync(resolve(v2Dir, 'src/auth.ts'), v2Code, 'utf-8')
// 用简化测试替换
writeFileSync(resolve(v2Dir, 'tests/auth.test.ts'), simplifiedTests, 'utf-8')
console.log('[V2] 完成')

// === 创建 V3（保留接口删除内部锁定逻辑——partial）===
console.log('[V3] 创建 partial 版本（保留接口删除逻辑）...')
const v3Dir = resolve(fixtureDir, 'v3-partial-fr003')
cpSync(srcDir, v3Dir, { recursive: true })
rmSync(resolve(v3Dir, 'tests/hidden-acceptance.test.ts'), { force: true })

let v3Code = readFileSync(resolve(v3Dir, 'src/auth.ts'), 'utf-8')
// 保留接口和配置，但删除实际锁定触发逻辑
v3Code = v3Code.replace(
  /\/\/ FR-003: 达到阈值触发锁定（AC-009）\n  if \(attempts >= lockThreshold\) \{[\s\S]*?  \}\n/,
  '// FR-003: 达到阈值应触发锁定，但实际锁定逻辑未实现\n'
)
writeFileSync(resolve(v3Dir, 'src/auth.ts'), v3Code, 'utf-8')
writeFileSync(resolve(v3Dir, 'tests/auth.test.ts'), simplifiedTests, 'utf-8')
console.log('[V3] 完成')

// === 创建 V4（阈值 5 改 10——contradicts）===
console.log('[V4] 创建 contradicts 版本（阈值5改10）...')
const v4Dir = resolve(fixtureDir, 'v4-contradicts-fr003')
cpSync(srcDir, v4Dir, { recursive: true })
rmSync(resolve(v4Dir, 'tests/hidden-acceptance.test.ts'), { force: true })

let v4Code = readFileSync(resolve(v4Dir, 'src/auth.ts'), 'utf-8')
// 修改默认阈值 5 -> 10
v4Code = v4Code.replace(
  /const DEFAULT_LOCK_THRESHOLD = 5 \/\/ AC-009 默认 5 次/,
  'const DEFAULT_LOCK_THRESHOLD = 10 // AC-009 Spec 要求 5 次，代码实现 10 次'
)
writeFileSync(resolve(v4Dir, 'src/auth.ts'), v4Code, 'utf-8')
writeFileSync(resolve(v4Dir, 'tests/auth.test.ts'), simplifiedTests, 'utf-8')
console.log('[V4] 完成')

// === 标准答案 ===
const answers = {
  versions: {
    'v1-complete': {
      description: '完整实现，所有需求正确',
      expectedGaps: [],
      fullyImplemented: true
    },
    'v2-missing-fr003': {
      description: '删除锁定触发逻辑，getLockStatus 始终返回未锁定，updateLockConfig 空操作',
      expectedGaps: [
        {
          requirementId: 'FR-003',
          expectedStatus: 'missing',
          defectLocation: 'src/auth.ts',
          defectDescription: '锁定触发逻辑被删除，阈值设为 999999，getLockStatus 始终返回 locked=false，updateLockConfig 为空操作'
        },
        {
          requirementId: 'FR-004',
          expectedStatus: 'missing',
          defectLocation: 'src/auth.ts',
          defectDescription: '锁定状态判定逻辑被删除（getLockStatus 始终返回未锁定）'
        },
        {
          requirementId: 'FR-005',
          expectedStatus: 'partial',
          defectLocation: 'src/auth.ts',
          defectDescription: 'adminUnlock 接口存在但无实际锁定状态可解除'
        }
      ],
      fullyImplemented: false
    },
    'v3-partial-fr003': {
      description: '保留锁定接口和配置，但删除实际锁定触发逻辑',
      expectedGaps: [
        {
          requirementId: 'FR-003',
          expectedStatus: 'partial',
          defectLocation: 'src/auth.ts',
          defectDescription: '达到阈值后不执行锁定（attempts >= lockThreshold 的 if 块被删除），failedAttempts 仍递增但不触发锁定'
        }
      ],
      fullyImplemented: false
    },
    'v4-contradicts-fr003': {
      description: '锁定阈值从 5 改为 10',
      expectedGaps: [
        {
          requirementId: 'FR-003',
          expectedStatus: 'contradicts',
          defectLocation: 'src/auth.ts:78',
          defectDescription: 'DEFAULT_LOCK_THRESHOLD = 10，Spec 要求 5 次，代码实现 10 次'
        }
      ],
      fullyImplemented: false
    }
  }
}

writeFileSync(resolve(fixtureDir, 'standard-answers.json'), JSON.stringify(answers, null, 2) + '\n', 'utf-8')
console.log('\n标准答案已保存: audit-fixtures/standard-answers.json')
console.log('4 个版本已准备完成:')
console.log('  V1: audit-fixtures/v1-complete/')
console.log('  V2: audit-fixtures/v2-missing-fr003/')
console.log('  V3: audit-fixtures/v3-partial-fr003/')
console.log('  V4: audit-fixtures/v4-contradicts-fr003/')
