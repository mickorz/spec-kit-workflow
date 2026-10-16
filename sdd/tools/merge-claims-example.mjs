#!/usr/bin/env node
// merge-claims-example.mjs — validate-claims + merge-claims 联合用例矩阵（CL-01~06 / M01~07）
// 用法: node sdd/tools/merge-claims-example.mjs
// 退出码: 0=全部通过, 1=有失败用例
// PRD 设计：例外句在两个章节重复出现，天然构造跨块完全重复（quote 必须真实存在于各自块内）

import { writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { execFileSync } from 'node:child_process'

const root = process.cwd()
const feature = 'merge-selftest'
const specDir = resolve('specs', feature)
const tmpPrd = resolve('specs', feature + '-prd.md')

function run(cmd) {
  try {
    const out = execFileSync('node', cmd, { cwd: root, encoding: 'utf-8', timeout: 30000, windowsHide: true, stdio: 'pipe' })
    return { code: 0, out }
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout || '') + (e.stderr || '') }
  }
}

const PRD = `# 堆叠规则

相同物品可以堆叠，堆叠上限 99。

已有物品可以堆叠，则仍然允许获得。

# 性能

已有物品可以堆叠，则仍然允许获得。

响应时间不超过 500ms。
`

function setup() {
  rmSync(specDir, { recursive: true, force: true })
  mkdirSync(specDir, { recursive: true })
  writeFileSync(tmpPrd, PRD, 'utf-8')
  run(['sdd/tools/prd-chunker.mjs', feature, '--from', tmpPrd, '--force'])
}

function writeClaims(id, claims) {
  mkdirSync(join(specDir, 'intake', 'claims'), { recursive: true })
  writeFileSync(join(specDir, 'intake', 'claims', id + '.json'), JSON.stringify({ chunkId: id, claims }, null, 2), 'utf-8')
}

// CHUNK-001 文件（相对行）：1=# 堆叠规则 2='' 3=堆叠句 4='' 5=例外句 6=''
// CHUNK-002 文件（相对行）：1=# 性能 2='' 3=例外句(重复) 4='' 5=性能句 6=''
function baseClaims() {
  return {
    'CHUNK-001': [
      { localId: 'L-001', text: '相同物品可堆叠，上限 99', claimType: 'functional', loadBearing: true, lineStart: 3, lineEnd: 3, quote: '相同物品可以堆叠，堆叠上限 99。' },
      { localId: 'L-002', text: '背包满时若可堆叠仍允许获得', claimType: 'exception', loadBearing: true, lineStart: 5, lineEnd: 5, quote: '已有物品可以堆叠，则仍然允许获得。' }
    ],
    'CHUNK-002': [
      { localId: 'L-001', text: '响应不超过 500ms', claimType: 'constraint', loadBearing: true, lineStart: 5, lineEnd: 5, quote: '响应时间不超过 500ms。' },
      { localId: 'L-002', text: '重复出现的例外要求', claimType: 'exception', loadBearing: true, lineStart: 3, lineEnd: 3, quote: '已有物品可以堆叠，则仍然允许获得。' }
    ]
  }
}

let passed = 0, failed = 0
const results = []
function check(id, name, ok, detail = '') {
  if (ok) { passed++; results.push(`[PASS] ${id} ${name}`) }
  else { failed++; results.push(`[FAIL] ${id} ${name} ${detail ? '— ' + detail : ''}`) }
}

// ================= CL 矩阵（validate-claims）=================

{
  setup()
  const c = baseClaims()
  writeClaims('CHUNK-001', c['CHUNK-001'])
  writeClaims('CHUNK-002', c['CHUNK-002'])
  const r = run(['sdd/tools/validate-claims.mjs', feature])
  check('CL-01', '合法块产物', r.code === 0, r.out.slice(0, 120))
}

{
  setup()
  const c = baseClaims()
  c['CHUNK-001'][0].lineStart = 5; c['CHUNK-001'][0].lineEnd = 5
  writeClaims('CHUNK-001', c['CHUNK-001'])
  const r = run(['sdd/tools/validate-claims.mjs', feature])
  check('CL-02', 'quote 区间不符被拒', r.code === 1 && r.out.includes('不一致'), r.out.slice(0, 100))
}

{
  setup()
  const c = baseClaims()
  c['CHUNK-001'][0].lineEnd = 999
  writeClaims('CHUNK-001', c['CHUNK-001'])
  const r = run(['sdd/tools/validate-claims.mjs', feature])
  check('CL-03', '行号越界被拒', r.code === 1 && r.out.includes('行号'), r.out.slice(0, 100))
}

{
  setup()
  const c = baseClaims()
  c['CHUNK-001'][0].claimType = 'perf'
  writeClaims('CHUNK-001', c['CHUNK-001'])
  const r = run(['sdd/tools/validate-claims.mjs', feature])
  check('CL-04', 'claimType 枚举外被拒', r.code === 1 && r.out.includes('枚举'), r.out.slice(0, 100))
}

{
  setup()
  const c = baseClaims()
  c['CHUNK-001'][1].localId = 'L-001'
  writeClaims('CHUNK-001', c['CHUNK-001'])
  const r = run(['sdd/tools/validate-claims.mjs', feature])
  check('CL-05', 'localId 重复被拒', r.code === 1 && r.out.includes('重复'), r.out.slice(0, 100))
}

{
  setup()
  writeClaims('CHUNK-001', [])
  const r = run(['sdd/tools/validate-claims.mjs', feature, 'CHUNK-001'])
  check('CL-06', '空块零 Claim 合法', r.code === 0, r.out.slice(0, 100))
}

// ================= M 矩阵（merge-claims）=================

// M01 换算 + M02 跨块完全重复 + M05 SRC 分配（无语义报告：确定性部分）
{
  setup()
  const c = baseClaims()
  writeClaims('CHUNK-001', c['CHUNK-001'])
  writeClaims('CHUNK-002', c['CHUNK-002'])
  const r = run(['sdd/tools/merge-claims.mjs', feature])
  const draft = JSON.parse(readFileSync(join(specDir, 'intake', 'draft-source-map.json'), 'utf-8'))
  const report = JSON.parse(readFileSync(join(specDir, 'intake', 'merge-report.json'), 'utf-8'))
  const m01 = draft.sources.every(s => {
    const prdLines = PRD.split('\n')
    const range = prdLines.slice(s.sourceRef.lineStart - 1, s.sourceRef.lineEnd).join(' ')
    return range.includes(s.sourceRef.quote.replace(/\s+/g, ' '))
  })
  const ids = draft.sources.map(s => s.sourceId)
  const m02 = report.duplicateGroups.length === 1 && report.duplicateGroups[0].merged.includes('L-002@CHUNK-002')
  const m05 = ids.length === new Set(ids).size && ids[0] === 'SRC-001' && JSON.stringify(ids) === JSON.stringify([...ids].sort())
  check('M01', '相对转绝对行号换算', r.code === 0 && m01, r.out.slice(0, 120))
  check('M02', '跨块完全重复归并', m02, JSON.stringify(report.duplicateGroups))
  check('M05', 'SRC 分配顺序唯一', m05 && draft.sources.length === 3, ids.join(','))
}

// M03 语义重复注入（不同 quote 的两条被 Merge Agent 判重复，来源保留）
{
  setup()
  const c = baseClaims()
  writeClaims('CHUNK-001', c['CHUNK-001'])
  writeClaims('CHUNK-002', c['CHUNK-002'])
  writeFileSync(join(specDir, 'intake', 'semantic.json'), JSON.stringify({
    duplicateGroups: [{ kept: 'L-001@CHUNK-001', merged: ['L-001@CHUNK-002'], reason: '模拟语义判定：两条合为一条' }],
    conflicts: []
  }), 'utf-8')
  const r = run(['sdd/tools/merge-claims.mjs', feature, '--semantic', join(specDir, 'intake', 'semantic.json')])
  const report = JSON.parse(readFileSync(join(specDir, 'intake', 'merge-report.json'), 'utf-8'))
  const src = JSON.parse(readFileSync(join(specDir, 'source-map.json'), 'utf-8'))
  const grp = report.srcAssignments.find(a => a.from === 'L-001@CHUNK-001')
  check('M03', '语义重复归并保留来源', r.code === 0 && grp && grp.alsoFrom.includes('L-001@CHUNK-002') && src.sources.length === 2, `src=${src.sources.length}`)
}

// M04 冲突未解决 → 退出码 2 / --expect conflict
{
  setup()
  const c = baseClaims()
  writeClaims('CHUNK-001', c['CHUNK-001'])
  writeClaims('CHUNK-002', c['CHUNK-002'])
  writeFileSync(join(specDir, 'intake', 'semantic.json'), JSON.stringify({
    duplicateGroups: [],
    conflicts: [{ claims: ['L-001@CHUNK-001', 'L-001@CHUNK-002'], description: '堆叠上限 99 vs 999', status: 'unresolved' }]
  }), 'utf-8')
  const r = run(['sdd/tools/merge-claims.mjs', feature, '--semantic', join(specDir, 'intake', 'semantic.json')])
  const e = run(['sdd/tools/merge-claims.mjs', feature, '--semantic', join(specDir, 'intake', 'semantic.json'), '--expect', 'conflict'])
  const report = JSON.parse(readFileSync(join(specDir, 'intake', 'merge-report.json'), 'utf-8'))
  check('M04', '冲突退出码 2 且 --expect conflict', r.code === 2 && e.code === 0 && report.unresolvedConflicts === 1, `r=${r.code} e=${e.code}`)
}

// M06 生成的 source-map 被 validate-source-map 接受（配套 spec + mappings，EARS-P3 契约联动）
{
  setup()
  const c = baseClaims()
  writeClaims('CHUNK-001', c['CHUNK-001'])
  writeClaims('CHUNK-002', c['CHUNK-002'])
  writeFileSync(join(specDir, 'intake', 'semantic.json'), JSON.stringify({ duplicateGroups: [], conflicts: [] }), 'utf-8')
  run(['sdd/tools/merge-claims.mjs', feature, '--semantic', join(specDir, 'intake', 'semantic.json')])
  writeFileSync(join(specDir, 'spec.md'), `# Feature: 测试

## 功能需求

### FR-001: 堆叠

描述。

**验收条件**：

- AC-001: When 相同物品进入背包,
  the 背包系统 shall 按堆叠规则存放且上限 99。

### FR-002: 背包满获得

描述。

**验收条件**：

- AC-002: If 背包已满且存在可堆叠格子,
  the 背包系统 shall 仍允许获得物品。

## 非功能需求

### NFR-001: 性能

描述。

**验收条件**：

- AC-003: The 背包服务 shall 保证响应时间不超过 500ms。
`, 'utf-8')
  writeFileSync(join(specDir, 'tasks.md'), '# Tasks\n\n## T-001: 全部任务\n\n描述。\n\nStatus: done\n', 'utf-8')
  writeFileSync(join(specDir, 'traceability.json'), JSON.stringify({
    feature,
    specHash: '',
    mappings: [
      { requirementId: 'FR-001', taskId: 'T-001', acceptanceIds: ['AC-001'], verificationMethod: 'test' },
      { requirementId: 'FR-002', taskId: 'T-001', acceptanceIds: ['AC-002'], verificationMethod: 'test' },
      { requirementId: 'NFR-001', taskId: 'T-001', acceptanceIds: ['AC-003'], verificationMethod: 'manual' }
    ]
  }, null, 2), 'utf-8')
  run(['sdd/tools/freeze-traceability.mjs', feature])
  const v = run(['sdd/tools/validate-source-map.mjs', feature, '--json'])
  // 此阶段 mappings 尚未填写（由工作流的 Source Mapping 阶段填写），
  // EARS-P3 契约对 sources 本身的接受度 = 仅允许 missing-mapping 与 unsupported-requirement
  //（两者都纯粹因 mappings 为空），其余（quote 元数据 归属 prdHash）必须零错误
  let detail = ''
  let ok = false
  try {
    const report = JSON.parse(v.out)
    const allowed = ['missing-mapping', 'unsupported-requirement']
    const bad = report.errors.filter(e => !allowed.includes(e.type))
    ok = bad.length === 0 && report.errors.length > 0 && report.stats.sources === 3
    detail = `errors=${report.errors.length} bad=${bad.length} ${bad.map(e=>e.type).join(',')}`
  } catch {
    detail = v.out.slice(0, 120)
  }
  check('M06', 'source-map 被 EARS P3 契约接受（仅待填 mappings）', ok, detail)
}

// M07 换算缺陷拦截：块内校验通过但篡改 manifest 行号后全文复核失配
{
  setup()
  const c = baseClaims()
  writeClaims('CHUNK-001', c['CHUNK-001'])
  writeClaims('CHUNK-002', c['CHUNK-002'])
  const ok = run(['sdd/tools/validate-claims.mjs', feature])
  const mFile = join(specDir, 'intake', 'manifest.json')
  const m = JSON.parse(readFileSync(mFile, 'utf-8'))
  m.chunks.find(x => x.chunkId === 'CHUNK-002').lineStart += 2
  writeFileSync(mFile, JSON.stringify(m, null, 2), 'utf-8')
  const r = run(['sdd/tools/merge-claims.mjs', feature])
  check('M07', '换算缺陷全文复核拦截', ok.code === 0 && r.code === 1 && r.out.includes('全文复核'), `ok=${ok.code} r=${r.code}`)
}

// 清理
rmSync(specDir, { recursive: true, force: true })
rmSync(tmpPrd, { force: true })

console.log(`merge-claims-example.mjs — 共 ${passed + failed} 个用例（CL 6 + M 6）\n`)
results.forEach(r => console.log(r))
console.log(`\n结果: ${passed}/${passed + failed} 通过, ${failed} 失败`)
process.exit(failed === 0 ? 0 : 1)
