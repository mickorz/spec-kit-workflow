#!/usr/bin/env node
// prepare-blind-test.mjs — 从 project-a (V1-clean) 生成 project-b/c/d 盲测版本
// 注入规则从工作区外的 injection-rules.json 读取，Reviewer 无法获取
import { cpSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import os from 'node:os'

const rootDir = process.cwd()
const baseDir = resolve('blind-test')
const rulesPath = resolve(os.homedir(), 'AppData/Local/Temp/opencode/blind-test-answers/injection-rules.json')
const answersPath = resolve(os.homedir(), 'AppData/Local/Temp/opencode/blind-test-answers/standard-answers.json')

function readFile(path) {
  let content = readFileSync(path, 'utf-8')
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1)
  return content
}

// 简化测试模板（缺陷版本用，不暴露缺陷意图）
const simplifiedTests = `import { describe, it, expect, beforeEach } from 'vitest'
import { registerUser, login, resetState, getLockStatus } from '../src/auth'

const IP = '127.0.0.1'

beforeEach(() => resetState())

describe('Basic login', () => {
  it('correct credentials login successfully', () => {
    registerUser('testuser', 'Passw0rd!')
    const result = login('testuser', 'Passw0rd!', IP)
    expect(result.success).toBe(true)
    expect(result.token).toBeDefined()
  })
  it('wrong password fails', () => {
    registerUser('testuser', 'Passw0rd!')
    const result = login('testuser', 'wrong', IP)
    expect(result.success).toBe(false)
  })
})
`

if (!existsSync(rulesPath)) {
  console.error('注入规则文件不存在: ' + rulesPath)
  console.error('请先运行外部初始化脚本创建 injection-rules.json')
  process.exit(1)
}

const rules = JSON.parse(readFile(rulesPath))
const projectNames = ['project-b', 'project-c', 'project-d']

// === project-a 已就绪（V1-clean）===
console.log('[project-a] 已就绪（V1-clean）')

// === 生成 project-b/c/d ===
const answers = {
  createdAt: new Date().toISOString(),
  note: '此文件仅供验收核对，存放在工作区外，Reviewer Agent 无法访问',
  versions: {
    'project-a': {
      description: '完整实现，所有需求正确',
      fullyImplemented: true,
      expectedGaps: []
    }
  }
}

for (const name of projectNames) {
  const rule = rules[name]
  if (!rule) {
    console.error(`未找到 ${name} 的注入规则`)
    continue
  }

  const dir = resolve(baseDir, name)
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
  cpSync(resolve(baseDir, 'project-a'), dir, { recursive: true })

  // 应用变换
  let code = readFileSync(resolve(dir, 'src/auth.ts'), 'utf-8')
  for (const transform of (rule.transforms || [])) {
    code = code.replace(new RegExp(transform.find, 'g'), transform.replace)
  }
  writeFileSync(resolve(dir, 'src/auth.ts'), code, 'utf-8')

  // 简化测试
  writeFileSync(resolve(dir, 'tests/auth.test.ts'), simplifiedTests, 'utf-8')
  rmSync(resolve(dir, 'tests/perf.test.ts'), { force: true })

  // 记录标准答案
  answers.versions[name] = {
    description: rule.description || `缺陷版本 ${name}`,
    fullyImplemented: false,
    expectedGaps: rule.expectedGaps || []
  }

  console.log(`[${name}] 完成`)
}

// 写入标准答案（工作区外）
mkdirSync(resolve(answersPath).replace(/[/\\][^/\\]+$/, ''), { recursive: true })
writeFileSync(answersPath, JSON.stringify(answers, null, 2) + '\n', 'utf-8')

console.log('\n盲测环境准备完成:')
console.log('  project-a: 完整实现 (V1-clean)')
console.log('  project-b: 缺陷版本 1')
console.log('  project-c: 缺陷版本 2')
console.log('  project-d: 缺陷版本 3')
console.log(`  标准答案: ${answersPath}`)
console.log(`  注入规则: ${rulesPath} (工作区外，Reviewer 无法访问)`)
