#!/usr/bin/env node
// run-hidden-acceptance.mjs — 运行隐藏验收测试并记录结果
// 用法: node experiments/run-hidden-acceptance.mjs <group> <trial>
// 隐藏验收测试从 experiments/fixtures/hidden-acceptance/ 复制到运行目录
// 然后在运行目录的 app/ 下执行

import { cpSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { execSync } from 'node:child_process'

const rootDir = process.cwd()
const group = process.argv[2]
const trial = process.argv[3]

if (!group || !trial) {
  console.error('Usage: node experiments/run-hidden-acceptance.mjs <group> <trial>')
  process.exit(1)
}

const runId = `${group}-${trial}`
const runDir = resolve('experiments', 'runs', runId)
const appDir = resolve(runDir, 'app')
const hiddenAcceptanceDir = resolve('experiments', 'fixtures', 'hidden-acceptance')
const resultsDir = resolve('experiments', 'results')
const resultFile = resolve(resultsDir, `${runId}.json`)

if (!existsSync(appDir)) {
  console.error(`[${runId}] app 目录不存在: ${appDir}`)
  process.exit(1)
}

// 复制隐藏验收测试到 app/tests/
const testDir = resolve(appDir, 'tests')
mkdirSync(testDir, { recursive: true })
cpSync(resolve(hiddenAcceptanceDir, 'hidden-acceptance.test.ts'), resolve(testDir, 'hidden-acceptance.test.ts'))

// 运行隐藏验收测试
console.log(`[${runId}] 运行隐藏验收测试...`)
let testOutput = ''
let testExitCode = 0
try {
  testOutput = execSync('npx vitest run tests/hidden-acceptance.test.ts', {
    cwd: appDir,
    encoding: 'utf-8',
    timeout: 120000,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  })
} catch (e) {
  testExitCode = e.status ?? 1
  testOutput = (e.stdout || '') + (e.stderr || '')
}

// 解析测试结果——找到 "Tests" 汇总行后提取数字
const cleanOutput = testOutput.replace(/\x1b\[[0-9;]*m/g, '')
// 先定位 "Tests  ..." 行（区别于 "Test Files  ..." 行）
const testsLineMatch = cleanOutput.match(/^\s*Tests\s+(.+)/im)
let passed = 0, failed = 0, total = 0
if (testsLineMatch) {
  const line = testsLineMatch[1]
  const pMatch = line.match(/(\d+)\s+passed/i)
  const fMatch = line.match(/(\d+)\s+failed/i)
  const tMatch = line.match(/\((\d+)\)/)
  passed = pMatch ? parseInt(pMatch[1], 10) : 0
  failed = fMatch ? parseInt(fMatch[1], 10) : 0
  total = tMatch ? parseInt(tMatch[1], 10) : (passed + failed)
}

// 提取失败的测试名
const failedTests = []
const failMatches = [...cleanOutput.matchAll(/(?:FAIL|failed|✗|×)\s+(.+?)$/gm)]
for (const m of failMatches.slice(0, 20)) {
  failedTests.push(m[1].trim().slice(0, 200))
}

// 写入结果
mkdirSync(resultsDir, { recursive: true })
const result = {
  runId,
  group,
  trial,
  hiddenAcceptance: {
    passed,
    failed,
    total,
    passRate: total > 0 ? (passed / total) : 0,
    failedTests: failedTests.slice(0, 10)
  },
  testOutput: cleanOutput.slice(0, 4000),
  timestamp: new Date().toISOString()
}

writeFileSync(resultFile, JSON.stringify(result, null, 2) + '\n', 'utf-8')

console.log(`[${runId}] 隐藏验收结果: ${passed}/${total} passed (${failed} failed)`)
if (failedTests.length > 0) {
  console.log(`[${runId}] 失败测试:`)
  failedTests.slice(0, 5).forEach(t => console.log(`  - ${t}`))
}
console.log(`[${runId}] 结果已保存: ${resultFile}`)
