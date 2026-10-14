#!/usr/bin/env node
// compare-blind-results.mjs — 比对审计结果与标准答案
// 用法: node scripts/compare-blind-results.mjs

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import os from 'node:os'

const answersPath = resolve(os.homedir(), 'AppData/Local/Temp/opencode/blind-test-answers/standard-answers.json')
const auditBase = resolve('audit-results')

function readFile(path) {
  let content = readFileSync(path, 'utf-8')
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1)
  return content
}

if (!existsSync(answersPath)) {
  console.error('标准答案文件不存在: ' + answersPath)
  process.exit(1)
}

const answers = JSON.parse(readFile(answersPath))
const versions = ['blind-a', 'blind-b', 'blind-c', 'blind-d']
const labelMap = {
  'blind-a': 'project-a (V1-clean)',
  'blind-b': 'project-b (missing)',
  'blind-c': 'project-c (partial)',
  'blind-d': 'project-d (contradicts)'
}

let totalHits = 0
let totalExpected = 0
let totalFalsePositives = 0
let totalClassificationErrors = 0
let totalCodeModified = 0

console.log('=== P0.7.1 盲测结果比对 ===\n')

for (const v of versions) {
  const reportPath = resolve(auditBase, v, 'audit-report.json')
  const beforePath = resolve(auditBase, v, 'snapshot-before.json')
  const afterPath = resolve(auditBase, v, 'snapshot-after.json')

  if (!existsSync(reportPath)) {
    console.log(`${v}: 审计报告不存在`)
    continue
  }

  const report = JSON.parse(readFile(reportPath))
  const key = v.replace('blind-', 'project-')
  const expected = answers.versions[key]?.expectedGaps || []
  const actualGaps = report.requirements.filter(x => x.status !== 'pass')

  // Check codeUnchanged
  let codeUnchanged = 'unknown'
  if (existsSync(beforePath) && existsSync(afterPath)) {
    const before = JSON.parse(readFile(beforePath))
    const after = JSON.parse(readFile(afterPath))
    const bm = new Map(before.files.map(f => [f.file, f.hash]))
    const am = new Map(after.files.map(f => [f.file, f.hash]))
    let changed = false
    for (const [f, h] of bm) {
      if (am.get(f) !== h) { changed = true; break }
    }
    codeUnchanged = !changed
    if (changed) totalCodeModified++
  }

  // Compare
  let hits = 0
  let falsePositives = []
  let classificationErrors = []

  for (const gap of actualGaps) {
    const exp = expected.find(e => e.id === gap.id)
    if (!exp) {
      falsePositives.push({ id: gap.id, status: gap.status })
      totalFalsePositives++
    } else {
      // Check if status matches
      const expStatus = exp.expectedStatus
      const actualStatus = gap.status
      if (expStatus === actualStatus ||
          expStatus.includes(actualStatus) ||
          (expStatus === 'missing_or_unverified' && (actualStatus === 'missing' || actualStatus === 'unverified')) ||
          (expStatus === 'missing_or_partial' && (actualStatus === 'missing' || actualStatus === 'partial')) ||
          (expStatus === 'partial_or_pass' && (actualStatus === 'partial' || actualStatus === 'pass')) ||
          (expStatus === 'partial_or_unverified' && (actualStatus === 'partial' || actualStatus === 'unverified'))) {
        hits++
        totalHits++
      } else {
        classificationErrors.push({ id: gap.id, expected: expStatus, actual: actualStatus })
        totalClassificationErrors++
      }
    }
  }

  // Count expected gaps that were not found
  const missedGaps = expected.filter(e => !actualGaps.some(g => g.id === e.id))
  for (const m of missedGaps) {
    if (m.expectedStatus === 'partial_or_pass' || m.expectedStatus === 'partial_or_unverified') {
      // These are acceptable if the actual status is pass (no gap found)
      hits++
      totalHits++
    }
  }

  totalExpected += expected.length

  console.log(`${labelMap[v] || v}:`)
  console.log(`  converged: ${report.converged}, codeUnchanged: ${codeUnchanged}`)
  console.log(`  expected gaps: ${expected.length}, actual gaps: ${actualGaps.length}`)
  console.log(`  hits: ${hits}/${expected.length}`)
  if (falsePositives.length > 0) {
    console.log(`  false positives: ${falsePositives.map(f => f.id + ':' + f.status).join(', ')}`)
  }
  if (classificationErrors.length > 0) {
    console.log(`  classification errors: ${classificationErrors.map(c => c.id + ' (expected ' + c.expected + ', got ' + c.actual + ')').join(', ')}`)
  }
  if (missedGaps.length > 0 && missedGaps.some(m => m.expectedStatus !== 'partial_or_pass' && m.expectedStatus !== 'partial_or_unverified')) {
    console.log(`  missed: ${missedGaps.map(m => m.id).join(', ')}`)
  }
  console.log()
}

console.log('=== 汇总 ===')
console.log(`检出命中: ${totalHits}/${totalExpected}`)
console.log(`假阳性: ${totalFalsePositives}`)
console.log(`分类错误: ${totalClassificationErrors}`)
console.log(`代码被修改: ${totalCodeModified}/4`)
