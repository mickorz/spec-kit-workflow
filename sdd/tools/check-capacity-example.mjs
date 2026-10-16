#!/usr/bin/env node
// check-capacity-example.mjs — 容量门禁与 run-report 用例矩阵（CAP-01~03 + RUN-01，LPRD-P3）
// 用法: node sdd/tools/check-capacity-example.mjs
// 退出码: 0=全部通过, 1=有失败用例

import { writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { execFileSync } from 'node:child_process'

const root = process.cwd()
const feature = 'cap-selftest'
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

const PRD = '# 章节\n\n需求内容一段。\n\n# 性能\n\n响应时间不超过 500ms。\n'

function setup() {
  rmSync(specDir, { recursive: true, force: true })
  mkdirSync(specDir, { recursive: true })
  writeFileSync(tmpPrd, PRD, 'utf-8')
  run(['sdd/tools/prd-chunker.mjs', feature, '--from', tmpPrd, '--force'])
  mkdirSync(join(specDir, 'intake', 'claims'), { recursive: true })
  writeFileSync(join(specDir, 'intake', 'claims', 'CHUNK-001.json'), JSON.stringify({
    chunkId: 'CHUNK-001',
    claims: [{ localId: 'L-001', text: '需求甲', claimType: 'functional', loadBearing: true, lineStart: 3, lineEnd: 3, quote: '需求内容一段。' }]
  }), 'utf-8')
  writeFileSync(join(specDir, 'intake', 'claims', 'CHUNK-002.json'), JSON.stringify({
    chunkId: 'CHUNK-002',
    claims: [{ localId: 'L-001', text: '性能', claimType: 'constraint', loadBearing: true, lineStart: 3, lineEnd: 3, quote: '响应时间不超过 500ms。' }]
  }), 'utf-8')
  writeFileSync(join(specDir, 'intake', 'semantic.json'), JSON.stringify({ duplicateGroups: [], conflicts: [] }))
  run(['sdd/tools/merge-claims.mjs', feature, '--semantic', join(specDir, 'intake', 'semantic.json')])
}

let passed = 0, failed = 0
const results = []
function check(id, name, ok, detail = '') {
  if (ok) { passed++; results.push(`[PASS] ${id} ${name}`) }
  else { failed++; results.push(`[FAIL] ${id} ${name} ${detail ? '— ' + detail : ''}`) }
}

// CAP-01 Claim 数超 maxClaims → 阻断且 capacity-report 落盘
{
  setup()
  // 临时改 config 阈值为 1
  const configPath = resolve('sdd', 'config.json')
  const orig = readFileSync(configPath, 'utf-8')
  const cfg = JSON.parse(orig)
  cfg.largePrd = { ...cfg.largePrd, maxClaims: 1 }
  writeFileSync(configPath, JSON.stringify(cfg, null, 2) + '\n')
  const r = run(['sdd/tools/check-capacity.mjs', feature])
  const rep = JSON.parse(readFileSync(join(specDir, 'intake', 'capacity-report.json'), 'utf-8'))
  writeFileSync(configPath, orig)
  check('CAP-01', 'Claim 超限阻断', r.code === 1 && r.out.includes('maxClaims') && rep.passed === false, r.out.slice(0, 100))
}

// CAP-02 oversize 块存在（阈值 0）→ 阻断
{
  setup()
  const configPath = resolve('sdd', 'config.json')
  const orig = readFileSync(configPath, 'utf-8')
  const cfg = JSON.parse(orig)
  // 手工把 manifest 某块标记 oversize + estTokens 超 budget（模拟巨型原子块）
  const mFile = join(specDir, 'intake', 'manifest.json')
  const m = JSON.parse(readFileSync(mFile, 'utf-8'))
  m.chunks[0].oversize = true
  m.chunks[0].estTokens = m.params.budget + 1
  writeFileSync(mFile, JSON.stringify(m, null, 2))
  const r = run(['sdd/tools/check-capacity.mjs', feature])
  writeFileSync(configPath, orig)
  check('CAP-02', 'oversize 阻断', r.code === 1 && r.out.includes('oversize'), r.out.slice(0, 100))
}

// CAP-03 各项未超限 → 放行
{
  setup()
  const r = run(['sdd/tools/check-capacity.mjs', feature])
  check('CAP-03', '未超限放行', r.code === 0 && r.out.includes('[OK] 容量门禁通过'), r.out.slice(0, 100))
}

// RUN-01 run-report 汇总字段
{
  setup()
  run(['sdd/tools/check-capacity.mjs', feature])
  // 补充 reviews 与聚合（模拟审查完成）
  mkdirSync(join(specDir, 'intake', 'reviews'), { recursive: true })
  writeFileSync(join(specDir, 'intake', 'reviews', 'CHUNK-001.json'), JSON.stringify({ chunkId: 'CHUNK-001', verdict: 'pass', missedClaims: [] }))
  writeFileSync(join(specDir, 'intake', 'reviews', 'CHUNK-002.json'), JSON.stringify({ chunkId: 'CHUNK-002', verdict: 'pass', missedClaims: [] }))
  run(['sdd/tools/aggregate-intake-review.mjs', feature])
  const r = run(['sdd/tools/run-report.mjs', feature])
  const rep = JSON.parse(readFileSync(join(specDir, 'intake', 'run-report.json'), 'utf-8'))
  const ok = r.code === 0 && rep.chunks.count === 2 && rep.claims.total === 2 &&
    rep.reviews.files === 2 && rep.reviews.verdicts.pass === 2 &&
    rep.merge.srcAssignments === 2 && rep.capacity === true && rep.intakeReview === 'pass'
  check('RUN-01', 'run-report 汇总字段', ok, JSON.stringify(rep).slice(0, 150))
}

// 清理
rmSync(specDir, { recursive: true, force: true })
rmSync(tmpPrd, { force: true })

console.log(`check-capacity-example.mjs — 共 ${passed + failed} 个用例\n`)
results.forEach(r => console.log(r))
console.log(`\n结果: ${passed}/${passed + failed} 通过, ${failed} 失败`)
process.exit(failed === 0 ? 0 : 1)
