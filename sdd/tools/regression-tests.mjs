#!/usr/bin/env node
// regression-tests.mjs — P0.6 回归测试：验证 Converge 不会出现假阳性
// 用法: node sdd/tools/regression-tests.mjs
// 退出码: 0=全部通过, 1=有失败

import { writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'

const rootDir = process.cwd()
const testFeature = 'regression-test'
const testDir = resolve('specs', testFeature)
const appDir = resolve('fixtures', testFeature + '-app')

function readFile(path) {
  let content = readFileSync(path, 'utf-8')
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1)
  return content
}

function fileHash(content) {
  return 'sha256-' + createHash('sha256').update(content).digest('hex')
}

function runTool(cmd) {
  try {
    const output = execSync(cmd, { cwd: rootDir, encoding: 'utf-8', timeout: 30000, windowsHide: true })
    return { exitCode: 0, output }
  } catch (e) {
    return { exitCode: e.status ?? 1, output: (e.stdout || '') + (e.stderr || '') }
  }
}

let passed = 0
let failed = 0
const results = []

function test(name, condition, details) {
  if (condition) {
    passed++
    results.push({ name, status: 'PASS' })
    console.log(`  [PASS] ${name}`)
  } else {
    failed++
    results.push({ name, status: 'FAIL', details })
    console.log(`  [FAIL] ${name}`)
    if (details) console.log(`         ${details}`)
  }
}

function setupMock(overrides = {}) {
  rmSync(testDir, { recursive: true, force: true })
  rmSync(appDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  mkdirSync(resolve(appDir, 'src'), { recursive: true })

  // Mock spec.md
  const spec = overrides.spec || `# Feature: regression-test

## 功能需求

### FR-001: 功能A
描述功能A。
**验收条件**：
- AC-001: 条件一
- AC-002: 条件二

### FR-002: 功能B
描述功能B。
**验收条件**：
- AC-003: 条件三

## 非功能需求

### NFR-001: 性能要求
响应时间不超过 500ms。
`
  writeFileSync(resolve(testDir, 'spec.md'), spec, 'utf-8')
  const specHash = fileHash(spec)

  // Mock source file
  const srcContent = overrides.srcContent || 'export function dummy() { return 42; }'
  writeFileSync(resolve(appDir, 'src', 'index.ts'), srcContent, 'utf-8')
  const srcHash = fileHash(srcContent)

  // Mock config.json
  const config = overrides.config || {
    features: {
      [testFeature]: {
        appDir: `fixtures/${testFeature}-app`,
        buildCommand: 'echo ok',
        testCommand: 'echo ok',
        sourceGlobs: ['src/**/*.ts'],
        testGlobs: ['tests/**/*.ts'],
        timeoutMs: 30000
      }
    }
  }
  // 读取现有 config.json 并合并
  const configPath = resolve('sdd', 'config.json')
  let existingConfig = {}
  try {
    existingConfig = JSON.parse(readFile(configPath))
  } catch {}
  existingConfig.features = existingConfig.features || {}
  existingConfig.features[testFeature] = config.features[testFeature]
  writeFileSync(configPath, JSON.stringify(existingConfig, null, 2) + '\n', 'utf-8')

  // Mock traceability.json
  const trace = overrides.traceability || {
    feature: testFeature,
    specHash,
    mappings: [
      { requirementId: 'FR-001', taskId: 'T-001', acceptanceIds: ['AC-001', 'AC-002'], verificationMethod: 'test' },
      { requirementId: 'FR-002', taskId: 'T-002', acceptanceIds: ['AC-003'], verificationMethod: 'test' },
      { requirementId: 'NFR-001', taskId: 'T-003', acceptanceIds: [], verificationMethod: 'manual' }
    ]
  }
  trace.specHash = specHash
  writeFileSync(resolve(testDir, 'traceability.json'), JSON.stringify(trace, null, 2) + '\n', 'utf-8')

  // Mock tasks.md
  const tasks = overrides.tasks || `## T-001: 功能A
- **Status**: done
## T-002: 功能B
- **Status**: done
## T-003: 性能
- **Status**: done`
  writeFileSync(resolve(testDir, 'tasks.md'), tasks, 'utf-8')

  // Mock approved-baseline.json
  writeFileSync(resolve(testDir, 'approved-baseline.json'), JSON.stringify({
    feature: testFeature,
    approvedSpecHash: specHash,
    approvedTraceabilityHash: fileHash(JSON.stringify(trace, null, 2) + '\n'),
    approvedTasksHash: fileHash(tasks),
    status: 'approved'
  }, null, 2) + '\n', 'utf-8')

  return { specHash, srcHash, specContent: spec }
}

function setupEvidence(overrides = {}) {
  const evidence = {
    feature: testFeature,
    round: overrides.round || 1,
    status: overrides.status || 'passed',
    build: {
      passed: overrides.buildPassed !== false,
      command: 'echo ok',
      exitCode: overrides.buildPassed === false ? 1 : 0,
      output: 'ok'
    },
    testResults: overrides.testResults || [
      { name: 'test A passes', status: 'passed' },
      { name: 'test B passes', status: 'passed' },
      { name: 'test C passes', status: 'passed' },
      { name: 'perf threshold check', status: 'passed' },
      { name: 'dummy returns 42', status: 'passed' }
    ],
    tests: {
      passed: overrides.testPassed ?? 5,
      failed: overrides.testFailed ?? 0,
      total: overrides.testTotal ?? 5,
      command: 'echo ok',
      exitCode: 0,
      output: '5 passed'
    },
    failures: overrides.failures || [],
    fileHashes: overrides.fileHashes || [
      { file: 'src/index.ts', hash: overrides.srcHash || setupMockData.srcHash }
    ],
    generatedAt: new Date().toISOString()
  }
  writeFileSync(resolve(testDir, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n', 'utf-8')
  return evidence
}

function setupReview(overrides = {}) {
  const specHash = setupMockData.specHash
  const review = {
    feature: testFeature,
    round: overrides.round || 1,
    specHash: overrides.specHash || specHash,
    reviewerLabel: overrides.reviewerLabel || 'Reviewer-Test',
    requirements: overrides.requirements || [
      {
        id: 'FR-001', status: 'pass', evidenceRefs: ['AC-001', 'AC-002'],
        verifications: [
          { ac: 'AC-001', type: 'automated_test', testId: 'test A passes', result: 'passed' },
          { ac: 'AC-002', type: 'automated_test', testId: 'test B passes', result: 'passed' }
        ],
        finding: null
      },
      {
        id: 'FR-002', status: 'pass', evidenceRefs: ['AC-003'],
        verifications: [
          { ac: 'AC-003', type: 'automated_test', testId: 'test C passes', result: 'passed' }
        ],
        finding: null
      },
      {
        id: 'NFR-001', status: 'pass', evidenceRefs: [],
        verifications: [
          { ac: null, type: 'static_check', testId: null, result: 'passed', reason: 'cost factor 10 confirmed', fileRef: 'src/index.ts:1' }
        ],
        finding: null
      }
    ]
  }
  writeFileSync(resolve(testDir, 'review.json'), JSON.stringify(review, null, 2) + '\n', 'utf-8')
  return review
}

// 全局 setup 数据
let setupMockData = {}

console.log('=== P0.6 回归测试套件 ===\n')

// === 测试 1: 正常场景基线（全部通过应 converged=true）===
console.log('测试 1: 正常场景基线')
setupMockData = setupMock()
setupMockData.srcHash = fileHash(setupMockData.specContent) // 先存一个假 hash
// 重新写入源码并获取真实 hash
const realSrc = 'export function dummy() { return 42; }'
writeFileSync(resolve(appDir, 'src', 'index.ts'), realSrc, 'utf-8')
const realSrcHash = fileHash(realSrc)
setupMockData.srcHash = realSrcHash

setupEvidence({ fileHashes: [{ file: 'src/index.ts', hash: realSrcHash }] })
setupReview()
const t1 = runTool(`node sdd/tools/is-converged.mjs ${testFeature} 1`)
const t1Report = JSON.parse(readFile(resolve(testDir, 'converge-report.json')))
test('基线 converged=true', t1Report.converged === true, `got ${t1Report.converged}`)
test('基线 7/7 条件通过', Object.values(t1Report.conditions).every(c => c.passed), `${Object.entries(t1Report.conditions).filter(([k,v])=>!v.passed).map(([k])=>k).join(',')} failed`)

// === 测试 2: 缺少 AC 证据 → C4 必须失败 ===
console.log('\n测试 2: 缺少 AC 证据（review.json 遗漏 AC-003）')
setupMockData = setupMock()
writeFileSync(resolve(appDir, 'src', 'index.ts'), realSrc, 'utf-8')
setupEvidence({ fileHashes: [{ file: 'src/index.ts', hash: realSrcHash }] })
// review.json 中 FR-002 的 evidenceRefs 为空（缺少 AC-003）
setupReview({
  requirements: [
    { id: 'FR-001', status: 'pass', evidenceRefs: ['AC-001', 'AC-002'], finding: null },
    { id: 'FR-002', status: 'pass', evidenceRefs: [], finding: null },
    { id: 'NFR-001', status: 'pass', evidenceRefs: [], finding: null }
  ]
})
const t2 = runTool(`node sdd/tools/is-converged.mjs ${testFeature} 1`)
const t2Report = JSON.parse(readFile(resolve(testDir, 'converge-report.json')))
test('C4 检测到 AC-003 未覆盖', t2Report.conditions.C4.passed === false, `C4=${t2Report.conditions.C4.passed}`)
test('converged=false', t2Report.converged === false, `converged=${t2Report.converged}`)

// === 测试 3: 文件哈希不匹配 → C6 必须失败 ===
console.log('\n测试 3: 源码被修改（文件哈希不匹配）')
setupMockData = setupMock()
writeFileSync(resolve(appDir, 'src', 'index.ts'), realSrc, 'utf-8')
// evidence.json 中记录旧 hash
setupEvidence({ fileHashes: [{ file: 'src/index.ts', hash: 'sha256-oldhash123' }] })
setupReview()
const t3 = runTool(`node sdd/tools/is-converged.mjs ${testFeature} 1`)
const t3Report = JSON.parse(readFile(resolve(testDir, 'converge-report.json')))
test('C6 检测到哈希不匹配', t3Report.conditions.C6.passed === false, `C6=${t3Report.conditions.C6.passed}`)
test('converged=false', t3Report.converged === false)

// === 测试 4: 伪造 review.json（缺少需求但标记 pass）→ validate-review 必须失败 ===
console.log('\n测试 4: 伪造 review.json（缺少 FR-002）')
setupMockData = setupMock()
writeFileSync(resolve(appDir, 'src', 'index.ts'), realSrc, 'utf-8')
setupEvidence({ fileHashes: [{ file: 'src/index.ts', hash: realSrcHash }] })
// review.json 缺少 FR-002
setupReview({
  requirements: [
    { id: 'FR-001', status: 'pass', evidenceRefs: ['AC-001', 'AC-002'], finding: null },
    { id: 'NFR-001', status: 'pass', evidenceRefs: [], finding: null }
  ]
})
const t4 = runTool(`node sdd/tools/validate-review.mjs ${testFeature} 1`)
const t4Result = JSON.parse(t4.output)
test('validate-review 检测到缺少 FR-002', t4Result.valid === false, `valid=${t4Result.valid}`)
test('错误信息包含 FR-002', t4Result.errors.some(e => e.includes('FR-002')), t4Result.errors.join('; '))

// === 测试 5: NFR unverified → C7 必须失败 ===
console.log('\n测试 5: NFR 状态为 unverified')
setupMockData = setupMock()
writeFileSync(resolve(appDir, 'src', 'index.ts'), realSrc, 'utf-8')
setupEvidence({ fileHashes: [{ file: 'src/index.ts', hash: realSrcHash }] })
setupReview({
  requirements: [
    { id: 'FR-001', status: 'pass', evidenceRefs: ['AC-001', 'AC-002'], finding: null },
    { id: 'FR-002', status: 'pass', evidenceRefs: ['AC-003'], finding: null },
    { id: 'NFR-001', status: 'unverified', evidenceRefs: [], finding: '无性能证据' }
  ]
})
const t5 = runTool(`node sdd/tools/is-converged.mjs ${testFeature} 1`)
const t5Report = JSON.parse(readFile(resolve(testDir, 'converge-report.json')))
test('C7 检测到 unverified 为阻断级', t5Report.conditions.C7.passed === false, `C7=${t5Report.conditions.C7.passed}`)
test('C3 检测到非 pass 状态', t5Report.conditions.C3.passed === false, `C3=${t5Report.conditions.C3.passed}`)
test('converged=false', t5Report.converged === false)

// === 测试 6: 构建失败 → C5 和 C7 必须失败 ===
console.log('\n测试 6: 构建失败')
setupMockData = setupMock()
writeFileSync(resolve(appDir, 'src', 'index.ts'), realSrc, 'utf-8')
setupEvidence({
  status: 'failed',
  buildPassed: false,
  testPassed: 0,
  testFailed: 0,
  testTotal: 0,
  failures: [{ test: 'build', reason: '构建失败' }],
  fileHashes: [{ file: 'src/index.ts', hash: realSrcHash }]
})
setupReview()
const t6 = runTool(`node sdd/tools/is-converged.mjs ${testFeature} 1`)
const t6Report = JSON.parse(readFile(resolve(testDir, 'converge-report.json')))
test('C5 检测到构建失败', t6Report.conditions.C5.passed === false, `C5=${t6Report.conditions.C5.passed}`)
test('C7 将构建失败列为阻断级', t6Report.conditions.C7.passed === false, `C7=${t6Report.conditions.C7.passed}`)
test('converged=false', t6Report.converged === false)

// === 测试 7: run-tests.mjs 退出码非零但有 passed 输出 ===
console.log('\n测试 7: run-tests.mjs 退出码回归保护')
// 这个测试验证 run-tests.mjs 的代码逻辑，不实际运行
// 检查 is-converged 在 evidence exitCode 非 0 时是否正确判定
setupMockData = setupMock()
writeFileSync(resolve(appDir, 'src', 'index.ts'), realSrc, 'utf-8')
setupEvidence({
  status: 'failed',
  testPassed: 49,
  testFailed: 0,
  testTotal: 49,
  fileHashes: [{ file: 'src/index.ts', hash: realSrcHash }]
})
// 设置 test exitCode 为非零（模拟进程崩溃但有 passed 输出）
const evFile = resolve(testDir, 'evidence.json')
const ev = JSON.parse(readFile(evFile))
ev.tests.exitCode = 1
writeFileSync(evFile, JSON.stringify(ev, null, 2) + '\n', 'utf-8')
setupReview()
const t7 = runTool(`node sdd/tools/is-converged.mjs ${testFeature} 1`)
const t7Report = JSON.parse(readFile(resolve(testDir, 'converge-report.json')))
test('C5 检测到 exitCode 非零', t7Report.conditions.C5.passed === false, `C5=${t7Report.conditions.C5.passed}`)
test('converged=false', t7Report.converged === false)

// === 测试 8: AC 有 testId 但不在 evidence.json testResults 中 → C4 必须失败 ===
console.log('\n测试 8: testId 不在 testResults 中')
setupMockData = setupMock()
writeFileSync(resolve(appDir, 'src', 'index.ts'), realSrc, 'utf-8')
setupEvidence({ fileHashes: [{ file: 'src/index.ts', hash: realSrcHash }] })
setupReview({
  requirements: [
    {
      id: 'FR-001', status: 'pass', evidenceRefs: ['AC-001', 'AC-002'],
      verifications: [
        { ac: 'AC-001', type: 'automated_test', testId: 'test A passes', result: 'passed' },
        { ac: 'AC-002', type: 'automated_test', testId: 'nonexistent test', result: 'passed' }
      ],
      finding: null
    },
    {
      id: 'FR-002', status: 'pass', evidenceRefs: ['AC-003'],
      verifications: [
        { ac: 'AC-003', type: 'automated_test', testId: 'test B passes', result: 'passed' }
      ],
      finding: null
    },
    {
      id: 'NFR-001', status: 'pass', evidenceRefs: [],
      verifications: [
        { ac: null, type: 'static_check', testId: null, result: 'passed', reason: 'cost factor 10 confirmed' }
      ],
      finding: null
    }
  ]
})
const t8 = runTool(`node sdd/tools/is-converged.mjs ${testFeature} 1`)
const t8Report = JSON.parse(readFile(resolve(testDir, 'converge-report.json')))
test('C4 检测到 testId 不在 testResults 中', t8Report.conditions.C4.passed === false, `C4=${t8Report.conditions.C4.passed}`)
test('C4 错误信息包含 nonexistent', t8Report.conditions.C4.details?.some(d => d.includes('nonexistent')) || false, (t8Report.conditions.C4.details || []).join('; '))
test('converged=false', t8Report.converged === false)

// === 测试 9: AC 关联到错误的 FR → C4 必须失败 ===
console.log('\n测试 9: AC 关联到错误的 FR')
setupMockData = setupMock()
writeFileSync(resolve(appDir, 'src', 'index.ts'), realSrc, 'utf-8')
setupEvidence({ fileHashes: [{ file: 'src/index.ts', hash: realSrcHash }] })
// AC-003 属于 FR-002，但被 FR-001 引用
setupReview({
  requirements: [
    {
      id: 'FR-001', status: 'pass', evidenceRefs: ['AC-001', 'AC-002', 'AC-003'],
      verifications: [
        { ac: 'AC-001', type: 'automated_test', testId: 'test A passes', result: 'passed' },
        { ac: 'AC-002', type: 'automated_test', testId: 'test B passes', result: 'passed' },
        { ac: 'AC-003', type: 'automated_test', testId: 'test C passes', result: 'passed' }
      ],
      finding: null
    },
    { id: 'FR-002', status: 'pass', evidenceRefs: [], finding: null },
    { id: 'NFR-001', status: 'pass', evidenceRefs: [], finding: null }
  ]
})
const t9 = runTool(`node sdd/tools/is-converged.mjs ${testFeature} 1`)
const t9Report = JSON.parse(readFile(resolve(testDir, 'converge-report.json')))
test('C4 检测到 AC 关联错误 FR', t9Report.conditions.C4.passed === false, `C4=${t9Report.conditions.C4.passed}`)
test('converged=false', t9Report.converged === false)

// === 测试 10: 正常场景含 verifications → C4 通过 ===
console.log('\n测试 10: 正常场景含 verifications')
setupMockData = setupMock()
writeFileSync(resolve(appDir, 'src', 'index.ts'), realSrc, 'utf-8')
setupEvidence({ fileHashes: [{ file: 'src/index.ts', hash: realSrcHash }] })
setupReview({
  requirements: [
    {
      id: 'FR-001', status: 'pass', evidenceRefs: ['AC-001', 'AC-002'],
      verifications: [
        { ac: 'AC-001', type: 'automated_test', testId: 'test A passes', result: 'passed' },
        { ac: 'AC-002', type: 'automated_test', testId: 'test B passes', result: 'passed' }
      ],
      finding: null
    },
    {
      id: 'FR-002', status: 'pass', evidenceRefs: ['AC-003'],
      verifications: [
        { ac: 'AC-003', type: 'automated_test', testId: 'test C passes', result: 'passed' }
      ],
      finding: null
    },
    {
      id: 'NFR-001', status: 'pass', evidenceRefs: [],
      verifications: [
        { ac: null, type: 'static_check', testId: null, result: 'passed', reason: 'cost factor 10 confirmed in code', fileRef: 'src/index.ts:1' }
      ],
      finding: null
    }
  ]
})
const t10 = runTool(`node sdd/tools/is-converged.mjs ${testFeature} 1`)
const t10Report = JSON.parse(readFile(resolve(testDir, 'converge-report.json')))
test('C4 含 verifications 全部通过', t10Report.conditions.C4.passed === true, `C4=${t10Report.conditions.C4.passed}`)
test('converged=true', t10Report.converged === true, `converged=${t10Report.converged}`)

// === 测试 11: 旧格式无 verifications → C4 必须 fail-closed ===
console.log('\n测试 11: 旧格式无 verifications（Strict fail-closed）')
setupMockData = setupMock()
writeFileSync(resolve(appDir, 'src', 'index.ts'), realSrc, 'utf-8')
setupEvidence({ fileHashes: [{ file: 'src/index.ts', hash: realSrcHash }] })
setupReview({
  requirements: [
    { id: 'FR-001', status: 'pass', evidenceRefs: ['AC-001', 'AC-002'], finding: null },
    { id: 'FR-002', status: 'pass', evidenceRefs: ['AC-003'], finding: null },
    { id: 'NFR-001', status: 'pass', evidenceRefs: [], finding: null }
  ]
})
const t11 = runTool(`node sdd/tools/is-converged.mjs ${testFeature} 1`)
const t11Report = JSON.parse(readFile(resolve(testDir, 'converge-report.json')))
test('C4 检测到无 verifications（fail-closed）', t11Report.conditions.C4.passed === false, `C4=${t11Report.conditions.C4.passed}`)
test('converged=false', t11Report.converged === false, `converged=${t11Report.converged}`)

// === 测试 12: static_check 无 fileRef → C4 必须失败 ===
console.log('\n测试 12: static_check 无 fileRef')
setupMockData = setupMock()
writeFileSync(resolve(appDir, 'src', 'index.ts'), realSrc, 'utf-8')
setupEvidence({ fileHashes: [{ file: 'src/index.ts', hash: realSrcHash }] })
setupReview({
  requirements: [
    {
      id: 'FR-001', status: 'pass', evidenceRefs: ['AC-001', 'AC-002'],
      verifications: [
        { ac: 'AC-001', type: 'automated_test', testId: 'test A passes', result: 'passed' },
        { ac: 'AC-002', type: 'automated_test', testId: 'test B passes', result: 'passed' }
      ],
      finding: null
    },
    {
      id: 'FR-002', status: 'pass', evidenceRefs: ['AC-003'],
      verifications: [
        { ac: 'AC-003', type: 'automated_test', testId: 'test C passes', result: 'passed' }
      ],
      finding: null
    },
    {
      id: 'NFR-001', status: 'pass', evidenceRefs: [],
      verifications: [
        { ac: null, type: 'static_check', testId: null, result: 'passed', reason: 'confirmed' }
        // Missing fileRef!
      ],
      finding: null
    }
  ]
})
const t12 = runTool(`node sdd/tools/is-converged.mjs ${testFeature} 1`)
const t12Report = JSON.parse(readFile(resolve(testDir, 'converge-report.json')))
test('C4 检测到 static_check 无 fileRef', t12Report.conditions.C4.passed === false, `C4=${t12Report.conditions.C4.passed}`)
test('converged=false', t12Report.converged === false)

// === 测试 13: manual 无 approver → C4 必须失败 ===
console.log('\n测试 13: manual 无 approver')
setupMockData = setupMock()
writeFileSync(resolve(appDir, 'src', 'index.ts'), realSrc, 'utf-8')
setupEvidence({ fileHashes: [{ file: 'src/index.ts', hash: realSrcHash }] })
setupReview({
  requirements: [
    {
      id: 'FR-001', status: 'pass', evidenceRefs: ['AC-001', 'AC-002'],
      verifications: [
        { ac: 'AC-001', type: 'automated_test', testId: 'test A passes', result: 'passed' },
        { ac: 'AC-002', type: 'automated_test', testId: 'test B passes', result: 'passed' }
      ],
      finding: null
    },
    {
      id: 'FR-002', status: 'pass', evidenceRefs: ['AC-003'],
      verifications: [
        { ac: 'AC-003', type: 'automated_test', testId: 'test C passes', result: 'passed' }
      ],
      finding: null
    },
    {
      id: 'NFR-001', status: 'pass', evidenceRefs: [],
      verifications: [
        { ac: null, type: 'manual', testId: null, result: 'passed', reason: '已人工确认' }
        // Missing approver!
      ],
      finding: null
    }
  ]
})
const t13 = runTool(`node sdd/tools/is-converged.mjs ${testFeature} 1`)
const t13Report = JSON.parse(readFile(resolve(testDir, 'converge-report.json')))
test('C4 检测到 manual 无 approver', t13Report.conditions.C4.passed === false, `C4=${t13Report.conditions.C4.passed}`)
test('converged=false', t13Report.converged === false)

// === 清理 ===
console.log('\n清理测试产物...')
// 恢复 config.json
const configPath = resolve('sdd', 'config.json')
let existingConfig = {}
try {
  existingConfig = JSON.parse(readFile(configPath))
} catch {}
delete existingConfig.features?.[testFeature]
writeFileSync(configPath, JSON.stringify(existingConfig, null, 2) + '\n', 'utf-8')
rmSync(testDir, { recursive: true, force: true })
rmSync(appDir, { recursive: true, force: true })

// === 汇总 ===
console.log(`\n=== 回归测试结果: ${passed} passed, ${failed} failed ===`)
process.exit(failed > 0 ? 1 : 0)
