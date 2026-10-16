#!/usr/bin/env node
// validate-preservation-example.mjs — validate-preservation.mjs 的用例矩阵测试（PV-01~PV-12）
// 用法: node sdd/tools/validate-preservation-example.mjs
// 退出码: 0=全部通过, 1=有失败用例

import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { execFileSync, execSync } from 'node:child_process'

const root = process.cwd()
const feature = 'preservation-selftest'
const specDir = resolve('specs', feature)

function runValidator(extra = []) {
  try {
    const out = execFileSync('node', ['sdd/tools/validate-preservation.mjs', feature, ...extra], {
      cwd: root, encoding: 'utf-8', timeout: 30000, windowsHide: true, stdio: 'pipe'
    })
    return { code: 0, out }
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout || '') + (e.stderr || '') }
  }
}

const SPEC = `# Feature: 自测

## 功能需求

### FR-001: 功能甲

描述。

**验收条件**：

- AC-001: When 玩家点击登录按钮,
  the 登录系统 shall 发起登录请求。

### FR-002: 功能乙

描述。

**验收条件**：

- AC-002: If 密码错误,
  the 登录系统 shall 返回错误提示。

## 非功能需求

### NFR-001: 性能

描述。

**验收条件**：

- AC-003: The 登录服务 shall 保证响应时间不超过 500ms。
`

const PRD = '需求1：点击登录发起请求。\n需求2：密码错误返回提示。\n需求3：响应不超过500ms。'

function baseMap() {
  return {
    feature,
    prdHash: '',
    sources: [
      { sourceId: 'SRC-001', text: '点击登录发起请求', status: 'confirmed', claimType: 'functional', loadBearing: true,
        sourceRef: { file: 'source-prd.md', lineStart: 1, lineEnd: 1, quote: '点击登录发起请求' } },
      { sourceId: 'SRC-002', text: '密码错误返回提示', status: 'confirmed', claimType: 'functional', loadBearing: true,
        sourceRef: { file: 'source-prd.md', lineStart: 2, lineEnd: 2, quote: '密码错误返回提示' } },
      { sourceId: 'SRC-003', text: '响应不超过500ms', status: 'confirmed', claimType: 'constraint', loadBearing: false,
        sourceRef: { file: 'source-prd.md', lineStart: 3, lineEnd: 3, quote: '响应不超过500ms' } }
    ],
    mappings: [
      { sourceId: 'SRC-001', requirementIds: ['FR-001'], acceptanceIds: ['AC-001'], disposition: 'covered', note: null },
      { sourceId: 'SRC-002', requirementIds: ['FR-002'], acceptanceIds: ['AC-002'], disposition: 'covered', note: null },
      { sourceId: 'SRC-003', requirementIds: ['NFR-001'], acceptanceIds: ['AC-003'], disposition: 'covered', note: null }
    ]
  }
}

function baseReview() {
  return {
    feature,
    verdict: 'pass',
    prdHash: '', specHash: '', sourceMapHash: '',
    claims: [
      { sourceId: 'SRC-001', requirementIds: ['FR-001'], acceptanceIds: ['AC-001'], status: 'preserved', severity: 'warning', sourceEvidence: null, specEvidence: null, finding: null },
      { sourceId: 'SRC-002', requirementIds: ['FR-002'], acceptanceIds: ['AC-002'], status: 'preserved', severity: 'warning', sourceEvidence: null, specEvidence: null, finding: null },
      { sourceId: 'SRC-003', requirementIds: ['NFR-001'], acceptanceIds: ['AC-003'], status: 'preserved', severity: 'warning', sourceEvidence: null, specEvidence: null, finding: null }
    ],
    intakeFindings: [],
    unsupportedRequirements: []
  }
}

function setup(review, map, spec = SPEC, prd = PRD, freeze = true) {
  rmSync(specDir, { recursive: true, force: true })
  mkdirSync(specDir, { recursive: true })
  writeFileSync(join(specDir, 'spec.md'), spec, 'utf-8')
  writeFileSync(join(specDir, 'source-prd.md'), prd, 'utf-8')
  writeFileSync(join(specDir, 'source-map.json'), JSON.stringify(map, null, 2), 'utf-8')
  writeFileSync(join(specDir, 'preservation-review.json'), JSON.stringify(review, null, 2), 'utf-8')
  if (freeze) {
    execSync(`node sdd/tools/freeze-preservation.mjs ${feature}`, { cwd: root, stdio: 'pipe', windowsHide: true })
  }
}

const cases = []

// PV-01 全 preserved 正例
cases.push({ id: 'PV-01', name: '全 preserved 正例', mutate: () => {}, expectCode: 0 })

// PV-02 claims 缺一个 SRC
cases.push({
  id: 'PV-02', name: 'claims 缺一个 SRC',
  mutate: r => { r.claims.pop() },
  expectCode: 1, expectText: '未被审查'
})

// PV-03 status 枚举外
cases.push({
  id: 'PV-03', name: 'status 枚举外',
  mutate: r => { r.claims[0].status = 'mostly-ok'; r.verdict = 'fix' },
  expectCode: 1, expectText: '六枚举'
})

// PV-04 contradicted 无 specEvidence
cases.push({
  id: 'PV-04', name: 'contradicted 无 specEvidence',
  mutate: r => {
    r.claims[0].status = 'contradicted'; r.claims[0].severity = 'blocker'
    r.claims[0].sourceEvidence = '原文引文'; r.claims[0].specEvidence = ''; r.claims[0].finding = '语义相反'
    r.verdict = 'fix'
  },
  expectCode: 1, expectText: 'specEvidence 为空'
})

// PV-05 specHash 过期（改 spec 后不重跑）
cases.push({
  id: 'PV-05', name: 'specHash 过期',
  mutate: r => {},
  afterSetup: () => { writeFileSync(join(specDir, 'spec.md'), SPEC + '\n<!-- 改动 -->\n', 'utf-8') },
  expectCode: 1, expectText: 'specHash'
})

// PV-06 sourceMapHash 过期
cases.push({
  id: 'PV-06', name: 'sourceMapHash 过期',
  mutate: r => {},
  afterSetup: () => {
    const m = baseMap(); m.mappings[0].note = '改动'
    writeFileSync(join(specDir, 'source-map.json'), JSON.stringify(m, null, 2), 'utf-8')
  },
  expectCode: 1, expectText: 'sourceMapHash'
})

// PV-07 blocker 与 pass 矛盾
cases.push({
  id: 'PV-07', name: 'blocker 与 pass 矛盾',
  mutate: r => {
    r.claims[0].status = 'missing'; r.claims[0].severity = 'blocker'
    r.claims[0].sourceEvidence = '原文'; r.claims[0].finding = '缺失'
    // verdict 保持 pass
  },
  expectCode: 1, expectText: '矛盾'
})

// PV-08 requirementIds 引用不存在
cases.push({
  id: 'PV-08', name: 'requirementIds 引用不存在',
  mutate: r => { r.claims[0].requirementIds = ['FR-099'] },
  expectCode: 1, expectText: '不存在'
})

// PV-09 acceptanceIds 归属错误
cases.push({
  id: 'PV-09', name: 'acceptanceIds 归属错误',
  mutate: r => { r.claims[0].acceptanceIds = ['AC-002'] },
  expectCode: 1, expectText: '不在本 claim'
})

// PV-10 excluded 状态带 finding（结构层通过）
cases.push({
  id: 'PV-10', name: 'excluded 状态带证据',
  mutate: r => {
    r.claims[2].status = 'excluded'; r.claims[2].severity = 'warning'
    r.claims[2].sourceEvidence = '响应不超过500ms'; r.claims[2].finding = '性能推迟'
    r.claims[2].requirementIds = []; r.claims[2].acceptanceIds = []
  },
  expectCode: 1, expectText: 'unsupported-requirement' // NFR-001 失去 covered 审查？不——claims 审查仍在；excluded 只是状态。
})

// 修正：PV-10 的 excluded 结构本身合法，但 verdict=pass 且 NFR-001 仍映射 covered 会矛盾吗？
// 不会：claims[].status 与 source-map.mappings[].disposition 是两层。excluded 状态合法。
// 但 source-map 中 SRC-003 disposition=covered，Gate B 判 excluded 属于语义分歧——P3 阶段不做交叉校验（P4 强化）。
// 预期：仅当引用合法时结构通过。这里 requirementIds 清空后无引用错误，应通过（verdict pass 无 blocker）。
cases[cases.length - 1].expectCode = 0
cases[cases.length - 1].expectText = null

// PV-11 uncertain 无 severity
cases.push({
  id: 'PV-11', name: 'uncertain 缺 severity',
  mutate: r => {
    r.claims[0].status = 'uncertain'; delete r.claims[0].severity
    r.claims[0].sourceEvidence = '原文'; r.claims[0].finding = '证据不足'
    r.verdict = 'clarify'
  },
  expectCode: 1, expectText: 'severity'
})

// PV-12 --expect 三态探测
cases.push({ id: 'PV-12', name: '--expect 三态探测', mutate: () => {}, expectCode: 0, expectMode: true })

// --- 执行 ---
let passed = 0
let failed = 0

console.log(`validate-preservation-example.mjs — 共 ${cases.length} 个用例\n`)

for (const c of cases) {
  const review = baseReview()
  c.mutate(review)
  setup(review, baseMap())
  if (c.afterSetup) c.afterSetup()

  if (c.expectMode) {
    // PV-12: pass 探测应 0，fix/clarify/invalid 探测应 1
    const p = runValidator(['--expect', 'pass'])
    const f = runValidator(['--expect', 'fix'])
    const cl = runValidator(['--expect', 'clarify'])
    const iv = runValidator(['--expect', 'invalid'])
    const ok = p.code === 0 && f.code === 1 && cl.code === 1 && iv.code === 1
    if (ok) { passed++; console.log(`[PASS] ${c.id} ${c.name}`) }
    else {
      failed++
      console.error(`[FAIL] ${c.id} ${c.name} — pass=${p.code} fix=${f.code} clarify=${cl.code} invalid=${iv.code}（期望 0/1/1/1）`)
    }
    continue
  }

  const { code, out } = runValidator()
  let ok = code === c.expectCode
  let detail = `exit=${code} (期望 ${c.expectCode})`
  if (ok && c.expectText) {
    if (!out.includes(c.expectText)) {
      ok = false
      detail += `，未包含关键词 "${c.expectText}"`
    }
  }
  if (ok && c.expectText === null) {
    // 预期通过的用例不应有 FAIL 输出（stdout 摘要）
    if (out.includes('[FAIL]')) { ok = false; detail += '，出现 [FAIL]' }
  }
  if (ok) { passed++; console.log(`[PASS] ${c.id} ${c.name}`) }
  else {
    failed++
    console.error(`[FAIL] ${c.id} ${c.name} — ${detail}`)
    console.error(out.split('\n').slice(0, 6).map(l => '  ' + l).join('\n'))
  }
}

// 清理
rmSync(specDir, { recursive: true, force: true })

console.log(`\n结果: ${passed}/${cases.length} 通过, ${failed} 失败`)
process.exit(failed === 0 ? 0 : 1)
