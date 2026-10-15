#!/usr/bin/env node
// compare-blind-results.mjs — 严格比对审计结果与标准答案
// 统计口径：
//   严格检出：预期有缺陷 → Reviewer 报告了缺口（任何非 pass 状态）
//   分类准确：已检出的缺口，其状态类型与预期匹配（含可接受范围）
//   假阳性：预期无缺陷 → Reviewer 报告了缺口
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

// 状态匹配函数：判断 actual 是否在 expected 的可接受范围内
function statusMatches(expectedStatus, actualStatus) {
  if (expectedStatus === actualStatus) return true
  const ranges = {
    'missing_or_unverified': ['missing', 'unverified'],
    'missing_or_partial': ['missing', 'partial'],
    'partial_or_unverified': ['partial', 'unverified'],
    'partial_or_pass': ['partial', 'pass']
  }
  const range = ranges[expectedStatus]
  return range ? range.includes(actualStatus) : false
}

// 判断预期是否为严格缺陷（不含 pass）
function isStrictDefect(expectedStatus) {
  return !expectedStatus.includes('pass')
}

let total_detection = 0, total_detected = 0
let total_classification = 0, total_classified = 0
let total_false_positives = 0
let total_code_modified = 0

console.log('=== P0.7.1 盲测结果严格比对 ===\n')

for (const v of versions) {
  const reportPath = resolve(auditBase, v, 'audit-report.json')
  const beforePath = resolve(auditBase, v, 'snapshot-before.json')
  const afterPath = resolve(auditBase, v, 'snapshot-after.json')

  if (!existsSync(reportPath)) {
    console.log(`${v}: 审计报告不存在，跳过`)
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
    if (changed) total_code_modified++
  }

  // 严格检出
  let v_detected = 0
  let v_strict_total = 0
  for (const exp of expected) {
    if (!isStrictDefect(exp.expectedStatus)) continue
    v_strict_total++
    total_detection++
    if (actualGaps.find(g => g.id === exp.id)) {
      v_detected++
      total_detected++
    }
  }

  // 分类准确（仅针对严格缺陷）
  let v_class_correct = 0
  let v_class_total = 0
  let v_class_wrong = []
  for (const gap of actualGaps) {
    const exp = expected.find(e => e.id === gap.id)
    if (!exp) continue  // 假阳性，跳过
    if (!isStrictDefect(exp.expectedStatus)) continue
    v_class_total++
    total_classification++
    if (statusMatches(exp.expectedStatus, gap.status)) {
      v_class_correct++
      total_classified++
    } else {
      v_class_wrong.push({ id: gap.id, expected: exp.expectedStatus, actual: gap.status })
    }
  }

  // 假阳性
  let v_false_pos = []
  for (const gap of actualGaps) {
    if (!expected.find(e => e.id === gap.id)) {
      v_false_pos.push({ id: gap.id, status: gap.status })
      total_false_positives++
    }
  }

  console.log(`${labelMap[v] || v}:`)
  console.log(`  converged: ${report.converged}, codeUnchanged: ${codeUnchanged}`)
  console.log(`  严格检出: ${v_detected}/${v_strict_total}`)
  if (v_class_total > 0) {
    console.log(`  分类准确: ${v_class_correct}/${v_class_total}`)
    if (v_class_wrong.length > 0) {
      console.log(`    分类错误: ${v_class_wrong.map(c => c.id + '(expected=' + c.expected + ',got=' + c.actual + ')').join(', ')}`)
    }
  }
  if (v_false_pos.length > 0) {
    console.log(`  假阳性: ${v_false_pos.map(f => f.id + ':' + f.status).join(', ')}`)
  } else {
    console.log(`  假阳性: 0`)
  }
  console.log()
}

console.log('=== 严格汇总 ===')
console.log(`严格检出率: ${total_detected}/${total_detection} (${total_detection > 0 ? Math.round(total_detected / total_detection * 100) : 0}%)`)
console.log(`分类准确率: ${total_classified}/${total_classification} (${total_classification > 0 ? Math.round(total_classified / total_classification * 100) : 0}%)`)
console.log(`假阳性总数: ${total_false_positives}`)
console.log(`代码被修改: ${total_code_modified}/4`)
