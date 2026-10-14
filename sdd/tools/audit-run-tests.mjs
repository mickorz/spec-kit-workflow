#!/usr/bin/env node
// audit-run-tests.mjs — 审计模式测试运行器（简化版，直接接收项目路径）
// 用法: node sdd/tools/audit-run-tests.mjs <projectPath> <outputDir>
// 输出: evidence.json 写入 outputDir
// 退出码: 0=测试执行成功(不管测试是否通过), 1=执行器自身异常

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { resolve, join, relative } from 'node:path'
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'

function readFile(path) {
  let content = readFileSync(path, 'utf-8')
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1)
  return content
}

function tryReadJson(path) {
  try { return JSON.parse(readFile(path)) } catch { return null }
}

function fileHash(filePath) {
  const content = readFileSync(filePath)
  return 'sha256-' + createHash('sha256').update(content).digest('hex')
}

function globToRegex(pattern) {
  let result = ''
  let i = 0
  while (i < pattern.length) {
    if (pattern[i] === '*' && pattern[i + 1] === '*') {
      if (pattern[i + 2] === '/') { result += '(?:[^/]*/)*'; i += 3 }
      else { result += '.*'; i += 2 }
    } else if (pattern[i] === '*') { result += '[^/]*'; i++ }
    else if (pattern[i] === '.') { result += '\\.'; i++ }
    else { result += pattern[i]; i++ }
  }
  return new RegExp('^' + result + '$')
}

function globMatch(baseDir, patterns) {
  const results = new Set()
  for (const pattern of patterns) {
    const regex = globToRegex(pattern)
    function walk(dir) {
      if (!existsSync(dir)) return
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        const rel = relative(baseDir, full).replace(/\\/g, '/')
        if (statSync(full).isDirectory()) walk(full)
        else if (regex.test(rel)) results.add(rel)
      }
    }
    walk(baseDir)
  }
  return [...results].sort()
}

function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '')
}

// 解析测试计数
function parseTestCounts(output) {
  const clean = stripAnsi(output)
  const testsLine = clean.match(/^\s*Tests\s+(.+)/im)
  if (!testsLine) return { passed: 0, failed: 0, total: 0 }
  const line = testsLine[1]
  const pMatch = line.match(/(\d+)\s+passed/i)
  const fMatch = line.match(/(\d+)\s+failed/i)
  const tMatch = line.match(/\((\d+)\)/)
  const passed = pMatch ? parseInt(pMatch[1], 10) : 0
  const failed = fMatch ? parseInt(fMatch[1], 10) : 0
  const total = tMatch ? parseInt(tMatch[1], 10) : (passed + failed)
  return { passed, failed, total }
}

// 解析逐测试结果（TAP 格式 + Vitest 格式）
function parseTestResults(output) {
  const clean = stripAnsi(output)
  const results = []
  // Vitest: ✓ 测试名 时间ms  或  × 测试名 时间ms
  const vitestPattern = /[✓✗×]\s+(.+?)\s+(\d+)ms/gm
  let match
  while ((match = vitestPattern.exec(clean)) !== null) {
    const name = match[1].trim()
    const passed = match[0].startsWith('✓')
    results.push({ name, status: passed ? 'passed' : 'failed' })
  }
  // TAP: ok N - 测试名  或  not ok N - 测试名
  if (results.length === 0) {
    const tapPattern = /^(ok|not ok)\s+\d+\s*-?\s*(.+)$/gm
    while ((match = tapPattern.exec(clean)) !== null) {
      const name = match[2].trim()
      const passed = match[1] === 'ok'
      results.push({ name, status: passed ? 'passed' : 'failed' })
    }
  }
  return results
}

// --- 主逻辑 ---
const projectPath = process.argv[2]
const outputDir = process.argv[3]

if (!projectPath || !outputDir) {
  console.error('Usage: node audit-run-tests.mjs <projectPath> <outputDir>')
  process.exit(1)
}

const appDir = resolve(projectPath)
const outDir = resolve(outputDir)
mkdirSync(outDir, { recursive: true })

if (!existsSync(appDir)) {
  console.error(`项目目录不存在: ${appDir}`)
  process.exit(1)
}

// 检测测试命令
let testCommand = 'npx vitest run'
let buildCommand = 'npx tsc --noEmit'

// 如果 package.json 存在，尝试使用其中的脚本（用 npx 前缀确保找到本地安装）
const pkgJson = tryReadJson(resolve(appDir, 'package.json'))
if (pkgJson && pkgJson.scripts) {
  if (pkgJson.scripts.test) testCommand = 'npx vitest run'
  if (pkgJson.scripts.build) buildCommand = 'npx tsc --noEmit'
}

// 1. 构建
let buildResult = { passed: true, output: '' }
try {
  buildCommand = buildCommand.replace(/^npm run /, 'npx ')
  const buildOutput = execSync(buildCommand, {
    cwd: appDir,
    encoding: 'utf-8',
    timeout: 60000,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  })
  buildResult.output = buildOutput.slice(0, 4000)
} catch (e) {
  buildResult.passed = false
  buildResult.output = ((e.stdout || '') + (e.stderr || '')).slice(0, 4000)
}

// 2. 测试
let testResult = { passed: true, output: '', counts: { passed: 0, failed: 0, total: 0 }, testResults: [] }
try {
  const testOutput = execSync(testCommand, {
    cwd: appDir,
    encoding: 'utf-8',
    timeout: 300000,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  })
  testResult.output = testOutput.slice(0, 8000)
  testResult.counts = parseTestCounts(testOutput)
  testResult.testResults = parseTestResults(testOutput)
  testResult.passed = testResult.counts.failed === 0 && testResult.counts.total > 0
  // 退出码非零但输出有 "passed" -> 保守判定为 failed
  testResult.passed = testResult.passed && buildResult.passed
} catch (e) {
  const rawOutput = (e.stdout || '') + (e.stderr || '')
  testResult.output = rawOutput.slice(0, 8000)
  testResult.counts = parseTestCounts(rawOutput)
  testResult.testResults = parseTestResults(rawOutput)
  testResult.passed = false
}

// 3. 文件哈希
const sourceGlobs = ['src/**/*.ts', 'src/**/*.js']
const testGlobs = ['tests/**/*.ts', 'tests/**/*.js']
const sourceFiles = globMatch(appDir, sourceGlobs)
const testFiles = globMatch(appDir, testGlobs)
const allFiles = [...sourceFiles, ...testFiles]
const fileHashes = allFiles.map(f => ({ file: f, hash: fileHash(resolve(appDir, f)) }))

// 4. 生成 evidence.json
const evidence = {
  feature: 'audit',
  round: 1,
  timestamp: new Date().toISOString(),
  build: buildResult,
  tests: {
    ...testResult.counts,
    results: testResult.testResults
  },
  status: (buildResult.passed && testResult.passed && testResult.counts.total > 0) ? 'passed' : 'failed',
  failures: testResult.counts.failed > 0 ? testResult.testResults.filter(t => t.status === 'failed').map(t => t.name) : [],
  fileHashes,
  testResults: testResult.testResults
}

const evidencePath = resolve(outDir, 'evidence.json')
writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n', 'utf-8')
console.log(`[audit-tests] evidence.json -> ${evidencePath}`)
console.log(`[audit-tests] build: ${buildResult.passed ? 'passed' : 'failed'}, tests: ${testResult.counts.passed}/${testResult.counts.total} passed`)
process.exit(0)
