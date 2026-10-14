#!/usr/bin/env node
// run-tests.mjs — Test Runner: 执行构建和测试，生成 evidence.json
// 用法: node sdd/tools/run-tests.mjs <feature> <round>
// 退出码: 0=脚本正常执行（含测试失败），1=脚本自身异常
// 三态语义: status=passed(全部通过) | failed(测试或构建失败) | error(Runner 自身异常)
// 关键：测试失败时仍退出 0 并保存 evidence.json，由 is-converged.mjs 判定

import { readFileSync, existsSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join, relative } from 'node:path'
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'

function readFile(path) {
  let content = readFileSync(path, 'utf-8')
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1)
  return content
}

function tryReadJson(path) {
  try {
    return JSON.parse(readFile(path))
  } catch {
    return null
  }
}

// 递归 glob 匹配（支持 ** 和 *）
function globToRegex(pattern) {
  let result = ''
  let i = 0
  while (i < pattern.length) {
    if (pattern[i] === '*' && pattern[i + 1] === '*') {
      if (pattern[i + 2] === '/') {
        result += '(?:[^/]*/)*'
        i += 3
      } else {
        result += '.*'
        i += 2
      }
    } else if (pattern[i] === '*') {
      result += '[^/]*'
      i++
    } else if (pattern[i] === '.') {
      result += '\\.'
      i++
    } else if (pattern[i] === '?') {
      result += '[^/]'
      i++
    } else {
      result += pattern[i]
      i++
    }
  }
  return new RegExp('^' + result + '$')
}

function globMatch(baseDir, patterns) {
  const results = new Set()
  for (const pattern of patterns) {
    const regex = globToRegex(pattern)
    function walk(dir) {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        const rel = relative(baseDir, full).replace(/\\/g, '/')
        if (statSync(full).isDirectory()) {
          walk(full)
        } else if (regex.test(rel)) {
          results.add(rel)
        }
      }
    }
    if (existsSync(baseDir)) walk(baseDir)
  }
  return [...results].sort()
}

function computeFileHashes(files, baseDir) {
  return files.map(f => {
    const fullPath = resolve(baseDir, f)
    let hash = null
    if (existsSync(fullPath)) {
      const content = readFileSync(fullPath)
      hash = 'sha256-' + createHash('sha256').update(content).digest('hex')
    }
    return { file: f, hash }
  })
}

// 解析逐测试结果——从输出中提取每个测试的名称和状态
function parseTestResults(output) {
  // 清除 ANSI 转义码
  const clean = output.replace(/\x1b\[[0-9;]*m/g, '')
  const results = []
  // TAP 格式: "ok N - test name" / "not ok N - test name"
  const tapMatches = [...clean.matchAll(/^(?:ok|not ok)\s+\d+\s+-?\s*(.*)$/gm)]
  for (const m of tapMatches) {
    const line = m[0].trim()
    const passed = line.startsWith('ok ') && !line.startsWith('not ok ')
    const name = m[1].trim() || line.replace(/^(?:not )?ok\s+\d+\s+-?\s*/, '')
    results.push({ name: name.slice(0, 200), status: passed ? 'passed' : 'failed' })
  }
  if (results.length > 0) return results

  // Vitest spec 格式: " ✓ test name" / " ✗ test name" / " × test name"
  // 只匹配含 ">" 的行（个别测试用例），跳过文件级汇总行
  const vitestMatches = [...clean.matchAll(/^\s*[✓✗×✔✖]\s+(.+)$/gm)]
  for (const m of vitestMatches) {
    const line = m[0].trim()
    const passed = /[✓✔]/.test(line.charAt(0))
    const name = m[1].trim().replace(/\s*\d+ms$/, '').slice(0, 200)
    results.push({ name, status: passed ? 'passed' : 'failed' })
  }
  // 如果只匹配到文件级结果（含 .test.ts），也保留——Reviewer 可引用
  if (results.length === 0) {
    // 兜底：尝试匹配含 "passed" 或 "failed" 的汇总行
    const summaryMatch = clean.match(/(\d+)\s+passed.*?(\d+)\s+failed/i)
    if (summaryMatch) {
      const passed = parseInt(summaryMatch[1], 10)
      for (let i = 0; i < passed; i++) {
        results.push({ name: `test-${i + 1}`, status: 'passed' })
      }
    }
  }
  return results
}

// 解析测试输出——支持多种测试框架格式
function parseTestCounts(output, testResult) {
  // 1. Node.js 内置 test runner: "# tests N", "# pass N", "# fail N" 或 "ℹ tests N" 等
  const nodeTests = output.match(/(?:#|\u2139)\s*tests\s+(\d+)/i)
  const nodePass = output.match(/(?:#|\u2139)\s*pass(?:ed)?\s+(\d+)/i)
  const nodeFail = output.match(/(?:#|\u2139)\s*fail(?:ed)?\s+(\d+)/i)
  if (nodeTests || nodePass || nodeFail) {
    if (nodePass) testResult.passed = parseInt(nodePass[1], 10)
    if (nodeFail) testResult.failed = parseInt(nodeFail[1], 10)
    if (nodeTests) testResult.total = parseInt(nodeTests[1], 10)
    else testResult.total = testResult.passed + testResult.failed
    return
  }

  // 2. Jest/Mocha: "N passing", "N failing", "N passed", "N failed"
  const passMatch = output.match(/(\d+)\s*(?:passed|passing)/i)
  const failMatch = output.match(/(\d+)\s*(?:failed|failing)/i)
  if (passMatch) testResult.passed = parseInt(passMatch[1], 10)
  if (failMatch) testResult.failed = parseInt(failMatch[1], 10)
  testResult.total = testResult.passed + testResult.failed

  // 3. 如果仍未解析到数量，尝试计数 checkmark 标记
  if (testResult.total === 0) {
    const checkmarks = (output.match(/[\u2714\u2713\u2714]/g) || []).length
    const crosses = (output.match(/[\u2716\u2717\u2718\u2715]/g) || []).length
    if (checkmarks > 0 || crosses > 0) {
      testResult.passed = checkmarks
      testResult.failed = crosses
      testResult.total = checkmarks + crosses
    }
  }
}

// --- 主逻辑 ---

const feature = process.argv[2]
const round = parseInt(process.argv[3] || '1', 10)

if (!feature) {
  console.error('Usage: node run-tests.mjs <feature> [round]')
  process.exit(1)
}

// 1. 读取配置
const configFile = resolve('sdd', 'config.json')
const config = tryReadJson(configFile)
if (!config || !config.features || !config.features[feature]) {
  console.error(`[ERROR] config.json 中未找到 feature "${feature}" 的配置`)
  process.exit(1)
}

const featureConfig = config.features[feature]
const appDir = resolve(featureConfig.appDir)
const buildCommand = featureConfig.buildCommand
const testCommand = featureConfig.testCommand
const timeoutMs = featureConfig.timeoutMs || 300000

// 2. 执行构建
let buildResult = { passed: false, command: buildCommand, exitCode: null, output: '' }
if (buildCommand) {
  try {
    const output = execSync(buildCommand, {
      cwd: appDir,
      timeout: timeoutMs,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })
    buildResult.passed = true
    buildResult.exitCode = 0
    buildResult.output = (output || '').slice(0, 4000)
  } catch (e) {
    buildResult.exitCode = e.status ?? 1
    buildResult.output = (e.stdout || '') + (e.stderr || '')
    buildResult.output = buildResult.output.slice(0, 4000)
  }
}

// 3. 执行测试（构建失败也尝试测试，记录完整证据）
let testResult = { passed: 0, failed: 0, total: 0, command: testCommand, exitCode: null, output: '', skipped: 0 }
if (testCommand && buildResult.passed) {
  try {
    const output = execSync(testCommand, {
      cwd: appDir,
      timeout: timeoutMs,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })
    testResult.exitCode = 0
    testResult.output = (output || '').slice(0, 8000)
    parseTestCounts(output, testResult)
    testResult.testResults = parseTestResults(output)
  } catch (e) {
    testResult.exitCode = e.status ?? 1
    testResult.output = ((e.stdout || '') + (e.stderr || '')).slice(0, 8000)
    parseTestCounts(testResult.output, testResult)
    testResult.testResults = parseTestResults(testResult.output)
  }
} else if (!buildResult.passed) {
  testResult.output = '构建失败，跳过测试执行'
  testResult.exitCode = null
}

// 4. 计算源码和测试文件哈希
const sourceGlobs = featureConfig.sourceGlobs || []
const testGlobs = featureConfig.testGlobs || []
const sourceFiles = globMatch(appDir, sourceGlobs)
const testFiles = globMatch(appDir, testGlobs)
const fileHashes = [
  ...computeFileHashes(sourceFiles, appDir),
  ...computeFileHashes(testFiles, appDir)
]

// 5. 判定状态
// 必须联合验证：退出码 + 失败计数 + 实际执行数
// 退出码非零时，即使输出中有 passed 计数也判定失败
let status
if (!buildCommand || buildResult.passed === undefined) {
  status = 'error'
} else if (!buildResult.passed) {
  status = 'failed'
} else if (testResult.exitCode !== null && testResult.exitCode !== 0) {
  // 测试进程退出码非零——不能判定通过，即使输出中含 passed 计数
  status = 'failed'
} else if (testResult.total === 0 && testResult.exitCode === 0) {
  // 退出 0 但无实际测试执行记录——不能判定通过
  status = 'failed'
} else if (testResult.failed === 0 && testResult.passed > 0) {
  status = 'passed'
} else {
  status = 'failed'
}

// 6. 提取失败详情
const failures = []
if (status === 'failed' && testResult.exitCode !== null && testResult.exitCode !== 0) {
  failures.push({ test: 'process', reason: `测试进程退出码非零 (${testResult.exitCode})，即使输出中含通过计数也不能判定成功` })
}
if (status === 'failed' && testResult.failed > 0) {
  const failNameMatches = [...testResult.output.matchAll(/(?:FAIL|failed|failing|not ok)[\s:]+([^\n]+)/gi)]
  for (const m of failNameMatches.slice(0, 20)) {
    failures.push({ test: m[1].trim().slice(0, 200), reason: '测试失败' })
  }
}
if (status === 'failed' && !buildResult.passed) {
  failures.push({ test: 'build', reason: '构建失败' })
}
if (status === 'failed' && testResult.total === 0 && (testResult.exitCode === 0 || testResult.exitCode === null)) {
  failures.push({ test: 'none', reason: '测试命令退出 0 但无实际测试执行记录' })
}

// 7. 写入 evidence.json
const dir = resolve('specs', feature)
const evidenceFile = resolve(dir, 'evidence.json')

const evidence = {
  feature,
  round,
  status,
  build: {
    passed: buildResult.passed,
    command: buildResult.command,
    exitCode: buildResult.exitCode,
    output: buildResult.output
  },
  tests: {
    passed: testResult.passed,
    failed: testResult.failed,
    total: testResult.total,
    command: testResult.command,
    exitCode: testResult.exitCode,
    output: testResult.output
  },
  testResults: testResult.testResults || [],
  failures,
  fileHashes,
  generatedAt: new Date().toISOString()
}

try {
  writeFileSync(evidenceFile, JSON.stringify(evidence, null, 2) + '\n', 'utf-8')
} catch (e) {
  console.error(`[ERROR] 无法写入 evidence.json: ${e.message}`)
  process.exit(1)
}

// 8. 输出摘要
console.log(`[${status.toUpperCase()}] Test Runner 完成`)
console.log(`  构建: ${buildResult.passed ? '通过' : '失败'} (exit ${buildResult.exitCode})`)
if (testResult.exitCode !== null) {
  console.log(`  测试: ${testResult.passed} passed, ${testResult.failed} failed, ${testResult.total} total (exit ${testResult.exitCode})`)
} else {
  console.log(`  测试: 跳过（构建失败）`)
}
console.log(`  文件哈希: ${fileHashes.length} 个`)
console.log(`  证据: ${evidenceFile}`)
// 退出 0 表示 runner 正常完成（即使测试失败），由 is-converged.mjs 判定收敛
process.exit(0)
