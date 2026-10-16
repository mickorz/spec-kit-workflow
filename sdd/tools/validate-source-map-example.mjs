#!/usr/bin/env node
// validate-source-map-example.mjs — validate-source-map.mjs 的用例矩阵测试（S01-S12）
// 用法: node sdd/tools/validate-source-map-example.mjs
// 退出码: 0=全部通过, 1=有失败用例

import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { execSync, execFileSync } from 'node:child_process'

const root = process.cwd()
const feature = 'srcmap-selftest'
const specDir = resolve('specs', feature)

function runValidator() {
  try {
    const out = execFileSync('node', ['sdd/tools/validate-source-map.mjs', feature, '--json'], {
      cwd: root, encoding: 'utf-8', timeout: 30000, windowsHide: true
    })
    return { code: 0, report: JSON.parse(out) }
  } catch (e) {
    const out = e.stdout || ''
    try { return { code: 1, report: JSON.parse(out) } } catch { return { code: 1, report: null } }
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

const PRD = '需求1：点击登录发起请求。需求2：密码错误返回提示。需求3：响应不超过500ms。'

function baseMap() {
  return {
    feature,
    prdHash: '',
    sources: [
      { sourceId: 'SRC-001', text: '点击登录发起请求', status: 'confirmed' },
      { sourceId: 'SRC-002', text: '密码错误返回提示', status: 'confirmed' },
      { sourceId: 'SRC-003', text: '响应不超过500ms', status: 'confirmed' }
    ],
    mappings: [
      { sourceId: 'SRC-001', requirementIds: ['FR-001'], acceptanceIds: ['AC-001'], disposition: 'covered', note: null },
      { sourceId: 'SRC-002', requirementIds: ['FR-002'], acceptanceIds: ['AC-002'], disposition: 'covered', note: null },
      { sourceId: 'SRC-003', requirementIds: ['NFR-001'], acceptanceIds: ['AC-003'], disposition: 'covered', note: null }
    ]
  }
}

function setup(map, prd = PRD, freeze = true, spec = SPEC) {
  rmSync(specDir, { recursive: true, force: true })
  mkdirSync(specDir, { recursive: true })
  writeFileSync(join(specDir, 'spec.md'), spec, 'utf-8')
  writeFileSync(join(specDir, 'source-prd.md'), prd, 'utf-8')
  writeFileSync(join(specDir, 'source-map.json'), JSON.stringify(map, null, 2), 'utf-8')
  if (freeze) {
    execSync(`node sdd/tools/freeze-source-map.mjs ${feature}`, { cwd: root, stdio: 'pipe', windowsHide: true })
  }
}

// 不含 NFR 的 spec（S02 excluded 场景专用：性能 SRC 被排除时 spec 不得有 NFR）
const SPEC_NO_NFR = SPEC.replace(/## 非功能需求[\s\S]*$/, '')

const cases = []

function addCase(id, name, mutate, expectCode, expectTypes = []) {
  const map = baseMap()
  mutate(map)
  cases.push({ id, name, map, expectCode, expectTypes })
}

// S01 完整正例
addCase('S01', '完整正例', () => {}, 0)

// S02 excluded 带理由（配套 spec 不含 NFR，验证纯 excluded 路径可通过）
cases.push({
  id: 'S02', name: 'excluded 带理由',
  mutate: m => {
    m.mappings[2] = { sourceId: 'SRC-003', requirementIds: [], acceptanceIds: [], disposition: 'excluded', note: '性能要求推迟到下轮' }
  },
  spec: SPEC_NO_NFR,
  expectCode: 0, expectTypes: []
})

// S03 pending 带理由
addCase('S03', 'pending 带理由', m => {
  m.mappings[1] = { sourceId: 'SRC-002', requirementIds: [], acceptanceIds: [], disposition: 'pending', note: '错误提示文案未定' }
}, 1, ['unsupported-requirement'])  // FR-002 失去来源 → 反向防漏触发

// S04 SRC 缺 mapping
addCase('S04', 'SRC 缺 mapping', m => { m.mappings.pop() }, 1, ['missing-mapping', 'unsupported-requirement'])

// S05 excluded 无理由
addCase('S05', 'excluded 无理由', m => {
  m.mappings[2] = { sourceId: 'SRC-003', requirementIds: [], acceptanceIds: [], disposition: 'excluded', note: '' }
}, 1, ['note-required', 'unsupported-requirement'])

// S06 covered 空引用
addCase('S06', 'covered 空引用', m => {
  m.mappings[2].requirementIds = []
  m.mappings[2].acceptanceIds = []
}, 1, ['empty-requirement', 'unsupported-requirement'])

// S07 引用不存在 FR
addCase('S07', '引用不存在 FR', m => {
  m.mappings[2].requirementIds = ['FR-099']
  m.mappings[2].acceptanceIds = []
}, 1, ['unknown-id', 'unsupported-requirement'])

// S08 AC 错误归属
addCase('S08', 'AC 错误归属', m => {
  m.mappings[0].acceptanceIds = ['AC-002']
}, 1, ['ownership'])

// S09 无依据新增（spec 中 FR 无 SRC 引用）
addCase('S09', '无依据新增', m => {
  m.mappings[1] = { sourceId: 'SRC-002', requirementIds: [], acceptanceIds: [], disposition: 'excluded', note: '不做' }
}, 1, ['unsupported-requirement'])

// S10 重复 SRC ID
addCase('S10', '重复 SRC ID', m => {
  m.sources.push({ sourceId: 'SRC-001', text: '重复', status: 'confirmed' })
}, 1, ['duplicate-id'])

// S11 prdHash 不匹配（source-prd.md 被改）
cases.push({
  id: 'S11', name: 'prdHash 不匹配',
  map: baseMap(), mutatePrd: true,
  expectCode: 1, expectTypes: ['prd-hash']
})

// S12 pending 带映射
addCase('S12', 'pending 带映射', m => {
  m.mappings[2] = { sourceId: 'SRC-003', requirementIds: ['NFR-001'], acceptanceIds: ['AC-003'], disposition: 'pending', note: '阈值待定' }
}, 1, ['disposition'])

// --- 执行 ---
let passed = 0
let failed = 0

console.log(`validate-source-map-example.mjs — 共 ${cases.length} 个用例\n`)

for (const c of cases) {
  const map = baseMap()
  if (c.mutate) c.mutate(map)
  setup(c.map || map, c.mutatePrd ? PRD + '（被改写）' : PRD, !c.mutatePrd, c.spec || SPEC)
  if (c.mutatePrd) {
    // 先冻结旧 PRD 哈希，再改写 PRD 造成不匹配
    setup(c.map, PRD, true)
    writeFileSync(join(specDir, 'source-prd.md'), PRD + '（被改写）', 'utf-8')
  }
  const { code, report } = runValidator()

  let ok = code === c.expectCode
  let detail = `exit=${code} (期望 ${c.expectCode})`

  if (ok && c.expectTypes.length > 0) {
    const actualTypes = new Set((report?.errors || []).map(e => e.type))
    for (const t of c.expectTypes) {
      if (!actualTypes.has(t)) {
        ok = false
        detail += `，缺少错误类型 ${t}（实际: ${[...actualTypes].join(',') || '无'}）`
        break
      }
    }
    if (ok && report?.errors?.length > 0) {
      for (const e of report.errors) {
        if (!e.target || !e.type || !e.message) {
          ok = false
          detail += '，诊断缺少 target/type/message 三要素'
          break
        }
      }
    }
  }

  if (ok) {
    passed++
    console.log(`[PASS] ${c.id} ${c.name}`)
  } else {
    failed++
    console.error(`[FAIL] ${c.id} ${c.name} — ${detail}`)
    if (report?.errors) {
      console.error('  实际错误:', report.errors.map(e => `${e.target}[${e.type}]`).join(', ') || '无')
    }
  }
}

// 清理
rmSync(specDir, { recursive: true, force: true })

console.log(`\n结果: ${passed}/${cases.length} 通过, ${failed} 失败`)
process.exit(failed === 0 ? 0 : 1)
