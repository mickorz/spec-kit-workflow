#!/usr/bin/env node
// validate-chunk-review-example.mjs — 块级 Gate A 审查 + 聚合的用例矩阵（CR-01~08）
// 用法: node sdd/tools/validate-chunk-review-example.mjs
// 退出码: 0=全部通过, 1=有失败用例

import { writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { execFileSync } from 'node:child_process'

const root = process.cwd()
const feature = 'chunkrev-selftest'
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

// 双章节 PRD；第二章预算调小制造 overlap 或多块（本矩阵用小预算拆两块验证主区间判定）
const PRD = `# 章节A

第一段需求内容甲。

第二段需求内容乙。

# 章节B

第三段需求内容丙。
`

function setup(budget = '100', overlap = '0') {
  rmSync(specDir, { recursive: true, force: true })
  mkdirSync(specDir, { recursive: true })
  writeFileSync(tmpPrd, PRD, 'utf-8')
  run(['sdd/tools/prd-chunker.mjs', feature, '--from', tmpPrd, '--force', '--budget', budget, '--overlap', overlap])
  mkdirSync(join(specDir, 'intake', 'reviews'), { recursive: true })
  mkdirSync(join(specDir, 'intake', 'claims'), { recursive: true })
}

function writeReview(id, obj) {
  writeFileSync(join(specDir, 'intake', 'reviews', id + '.json'), JSON.stringify(obj, null, 2), 'utf-8')
}
function writeClaimsFile(id, claims) {
  writeFileSync(join(specDir, 'intake', 'claims', id + '.json'), JSON.stringify({ chunkId: id, claims }, null, 2), 'utf-8')
}
function manifest() {
  return JSON.parse(readFileSync(join(specDir, 'intake', 'manifest.json'), 'utf-8'))
}

let passed = 0, failed = 0
const results = []
function check(id, name, ok, detail = '') {
  if (ok) { passed++; results.push(`[PASS] ${id} ${name}`) }
  else { failed++; results.push(`[FAIL] ${id} ${name} ${detail ? '— ' + detail : ''}`) }
}

// 基础：CHUNK-001（章节A，行 1-6）、CHUNK-002（章节B，行 7-9）
// CHUNK-001 相对主区间 = [1,6]；CHUNK-002 = [1,3]

// CR-01 全 pass 聚合 → intake-review.json 被 EARS-P3 validate-intake-review 接受
{
  setup()
  writeReview('CHUNK-001', { chunkId: 'CHUNK-001', verdict: 'pass', missedClaims: [] })
  writeReview('CHUNK-002', { chunkId: 'CHUNK-002', verdict: 'pass', missedClaims: [] })
  const agg = run(['sdd/tools/aggregate-intake-review.mjs', feature])
  const iv = run(['sdd/tools/validate-intake-review.mjs', feature, '--expect', 'pass'])
  check('CR-01', '全 pass 聚合且被 P3 契约接受', agg.code === 0 && iv.code === 0, `agg=${agg.code} iv=${iv.code} ${agg.out.slice(0, 80)}`)
}

// CR-02 某块 fix（含遗漏）→ 聚合 fix，绝对行号正确
{
  setup()
  writeReview('CHUNK-001', { chunkId: 'CHUNK-001', verdict: 'pass', missedClaims: [] })
  writeReview('CHUNK-002', {
    chunkId: 'CHUNK-002', verdict: 'fix',
    missedClaims: [{ quote: '第三段需求内容丙。', lineStart: 3, lineEnd: 3, suggestedClaimType: 'functional', reason: '该需求未被提取' }]
  })
  const agg = run(['sdd/tools/aggregate-intake-review.mjs', feature, '--json', '--expect', 'fix'])
  const ir = JSON.parse(readFileSync(join(specDir, 'intake-review.json'), 'utf-8'))
  const m = manifest()
  const c2 = m.chunks.find(c => c.chunkId === 'CHUNK-002')
  const absOk = ir.missedClaims.length === 1 && ir.missedClaims[0].lineStart === c2.lineStart + 3 - 1 && ir.missedClaims[0].chunkId === 'CHUNK-002'
  check('CR-02', 'fix 聚合含绝对行号', agg.code === 0 && absOk, `agg=${agg.code} ir=${JSON.stringify(ir.missedClaims)}`)
}

// CR-03 缺一块审查文件 → 聚合失败
{
  setup()
  writeReview('CHUNK-001', { chunkId: 'CHUNK-001', verdict: 'pass', missedClaims: [] })
  const agg = run(['sdd/tools/aggregate-intake-review.mjs', feature])
  check('CR-03', '缺审查文件聚合失败', agg.code === 1 && agg.out.includes('缺失'), agg.out.slice(0, 80))
}

// CR-04 quote 落在 overlap 前缀区 → 拒绝
{
  setup('15', '1') // 小预算拆两块且开启 overlap → 第二块带前缀
  const m = manifest()
  const withOv = m.chunks.find(c => c.overlapStart !== null)
  if (!withOv) {
    check('CR-04', 'overlap 前缀落界', false, 'fixture 未产生 overlap 块')
  } else {
    // overlap 前缀行 = 主区间之前的行；构造 quote 引用前缀区行号
    const fileStart1 = withOv.overlapStart
    const prefixRel = withOv.lineStart - fileStart1 // 前缀最后一行的相对行号
    const chunkLines = readFileSync(join(specDir, 'intake', 'chunks', withOv.chunkId + '.md'), 'utf-8').split('\n')
    const prefixQuote = chunkLines[prefixRel - 1]
    writeReview(withOv.chunkId, {
      chunkId: withOv.chunkId, verdict: 'fix',
      missedClaims: [{ quote: prefixQuote, lineStart: prefixRel, lineEnd: prefixRel, suggestedClaimType: 'functional', reason: '落在前缀区' }]
    })
    const v = run(['sdd/tools/validate-chunk-review.mjs', feature, withOv.chunkId])
    check('CR-04', 'overlap 前缀区遗漏被拒', v.code === 1 && v.out.includes('主区间'), v.out.slice(0, 100))
  }
}

// CR-05 quote 不在本块文本 → 拒绝
{
  setup()
  writeReview('CHUNK-001', {
    chunkId: 'CHUNK-001', verdict: 'fix',
    missedClaims: [{ quote: '完全不存在的引文内容。', lineStart: 3, lineEnd: 3, suggestedClaimType: 'functional', reason: 'x' }]
  })
  const v = run(['sdd/tools/validate-chunk-review.mjs', feature, 'CHUNK-001'])
  check('CR-05', 'quote 不在本块被拒', v.code === 1 && v.out.includes('不一致'), v.out.slice(0, 100))
}

// CR-06 verdict=pass 但 missedClaims 非空 → 拒绝
{
  setup()
  writeReview('CHUNK-001', {
    chunkId: 'CHUNK-001', verdict: 'pass',
    missedClaims: [{ quote: '第一段需求内容甲。', lineStart: 3, lineEnd: 3, suggestedClaimType: 'functional', reason: 'x' }]
  })
  const v = run(['sdd/tools/validate-chunk-review.mjs', feature, 'CHUNK-001'])
  check('CR-06', 'pass 带遗漏矛盾被拒', v.code === 1 && v.out.includes('矛盾'), v.out.slice(0, 100))
}

// CR-07 补漏后重聚：missedClaim 的 quote 出现在该块 claims 中 → 视为已解决
{
  setup()
  writeReview('CHUNK-001', { chunkId: 'CHUNK-001', verdict: 'pass', missedClaims: [] })
  writeReview('CHUNK-002', {
    chunkId: 'CHUNK-002', verdict: 'fix',
    missedClaims: [{ quote: '第三段需求内容丙。', lineStart: 3, lineEnd: 3, suggestedClaimType: 'functional', reason: '未提取' }]
  })
  // 首次聚合 → fix
  const agg1 = run(['sdd/tools/aggregate-intake-review.mjs', feature, '--expect', 'fix'])
  // Gate-A-Fix 补漏：claims 文件出现同 quote → 重聚 → pass
  writeClaimsFile('CHUNK-002', [
    { localId: 'L-001', text: '第三段需求', claimType: 'functional', loadBearing: true, lineStart: 3, lineEnd: 3, quote: '第三段需求内容丙。' }
  ])
  const agg2 = run(['sdd/tools/aggregate-intake-review.mjs', feature, '--expect', 'pass'])
  check('CR-07', '补漏后重聚 pass', agg1.code === 0 && agg2.code === 0, `agg1=${agg1.code} agg2=${agg2.code}`)
}

// CR-08 --expect 三态
{
  setup()
  writeReview('CHUNK-001', { chunkId: 'CHUNK-001', verdict: 'pass', missedClaims: [] })
  writeReview('CHUNK-002', {
    chunkId: 'CHUNK-002', verdict: 'fix',
    missedClaims: [{ quote: '第三段需求内容丙。', lineStart: 3, lineEnd: 3, suggestedClaimType: 'functional', reason: '未提取' }]
  })
  const p = run(['sdd/tools/aggregate-intake-review.mjs', feature, '--expect', 'pass'])
  const f = run(['sdd/tools/aggregate-intake-review.mjs', feature, '--expect', 'fix'])
  check('CR-08', '--expect 三态', p.code === 1 && f.code === 0, `p=${p.code} f=${f.code}`)
}

// 清理
rmSync(specDir, { recursive: true, force: true })
rmSync(tmpPrd, { force: true })

console.log(`validate-chunk-review-example.mjs — 共 ${passed + failed} 个用例\n`)
results.forEach(r => console.log(r))
console.log(`\n结果: ${passed}/${passed + failed} 通过, ${failed} 失败`)
process.exit(failed === 0 ? 0 : 1)
