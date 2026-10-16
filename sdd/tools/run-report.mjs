#!/usr/bin/env node
// run-report.mjs — 大文档处理状态与成本统计汇总（LPRD-P3，确定性）
// 用法: node sdd/tools/run-report.mjs <feature>
// 产出 specs/<feature>/intake/run-report.json，退出码恒 0（诊断工具不阻断）

import { readFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'

const feature = process.argv[2]
if (!feature) {
  console.error('Usage: node sdd/tools/run-report.mjs <feature>')
  process.exit(1)
}

const dir = resolve('specs', feature)
const intakeDir = join(dir, 'intake')

function tryReadJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf-8')) } catch { return null }
}

const report = { feature, generatedFor: feature }

const manifest = tryReadJson(join(intakeDir, 'manifest.json'))
if (manifest) {
  report.chunks = {
    count: manifest.chunkCount,
    oversize: (manifest.chunks || []).filter(c => c.oversize).length,
    estTokensTotal: manifest.estTokensTotal,
    budget: manifest.params?.budget
  }
}

const claimsDir = join(intakeDir, 'claims')
if (existsSync(claimsDir)) {
  const files = readdirSync(claimsDir).filter(f => f.endsWith('.json'))
  let total = 0, empty = 0
  for (const f of files) {
    const d = tryReadJson(join(claimsDir, f))
    const n = (d?.claims || []).length
    total += n
    if (n === 0) empty++
  }
  report.claims = { files: files.length, total, emptyChunks: empty }
}

const reviewsDir = join(intakeDir, 'reviews')
if (existsSync(reviewsDir)) {
  const files = readdirSync(reviewsDir).filter(f => f.endsWith('.json'))
  const verdicts = { pass: 0, fix: 0 }
  let missed = 0
  for (const f of files) {
    const d = tryReadJson(join(reviewsDir, f))
    if (d?.verdict && verdicts[d.verdict] !== undefined) verdicts[d.verdict]++
    missed += (d?.missedClaims || []).length
  }
  report.reviews = { files: files.length, verdicts, missedClaimsRaw: missed }
}

const mergeReport = tryReadJson(join(intakeDir, 'merge-report.json'))
if (mergeReport) {
  report.merge = {
    duplicateGroups: (mergeReport.duplicateGroups || []).length,
    conflicts: (mergeReport.conflicts || []).length,
    unresolvedConflicts: mergeReport.unresolvedConflicts || 0,
    srcAssignments: (mergeReport.srcAssignments || []).length
  }
}

report.capacity = tryReadJson(join(intakeDir, 'capacity-report.json'))?.passed ?? null
report.intakeReview = tryReadJson(join(dir, 'intake-review.json'))?.verdict ?? null

writeFileSync(join(intakeDir, 'run-report.json'), JSON.stringify(report, null, 2) + '\n', 'utf-8')
console.log(JSON.stringify(report))
process.exit(0)
