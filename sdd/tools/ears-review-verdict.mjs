#!/usr/bin/env node
// ears-review-verdict.mjs — 确定性读取 ears-review.json 的 verdict
// 用法: node sdd/tools/ears-review-verdict.mjs <feature> [--expect pass|fix|clarify|invalid]
// 退出码:（无 --expect）0=pass, 2=fix(需自动修复), 3=clarify(需人工澄清), 1=结构非法
//        （有 --expect）期望匹配时退出 0，否则退出 1 —— 适配 workflow 运行时仅提供 commandSuccess 布尔原语
// 结构契约见 sdd/rules/ears-semantic-review.md

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseSpec } from './spec-parser.mjs'

function tryReadJson(path) {
  try {
    let content = readFileSync(path, 'utf-8')
    if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1)
    return JSON.parse(content)
  } catch {
    return null
  }
}

const feature = process.argv.find((a, i) => i >= 2 && !a.startsWith('--'))
const expectIdx = process.argv.indexOf('--expect')
const expectMode = expectIdx >= 0 ? process.argv[expectIdx + 1] : null
if (!feature || (expectMode && !['pass', 'fix', 'clarify', 'invalid'].includes(expectMode))) {
  console.error('Usage: node sdd/tools/ears-review-verdict.mjs <feature> [--expect pass|fix|clarify|invalid]')
  process.exit(1)
}

const dir = resolve('specs', feature)
const reviewFile = resolve(dir, 'ears-review.json')
const specFile = resolve(dir, 'spec.md')

const errors = []

if (!existsSync(reviewFile)) {
  console.error('[FAIL] ears-review.json 不存在')
  process.exit(1)
}

const review = tryReadJson(reviewFile)
if (!review) {
  console.error('[FAIL] ears-review.json JSON 解析失败')
  process.exit(1)
}

// 1. verdict 枚举
const VERDICTS = ['pass', 'fix', 'clarify']
const exitFor = { pass: 0, fix: 2, clarify: 3 }
if (!VERDICTS.includes(review.verdict)) {
  errors.push(`verdict "${review.verdict}" 不在枚举 ${VERDICTS.join('|')} 中`)
}

// 2. feature 一致性
if (review.feature !== feature) {
  errors.push(`feature 不匹配: review=${review.feature}, expected=${feature}`)
}

// 3. issues 结构
const TYPES = [
  'untestable', 'ambiguous', 'multi-behavior', 'contradicts', 'duplicate',
  'implementation-detail', 'unsupported-rule', 'needs-clarification', 'coverage-gap'
]
const SEVERITIES = ['blocker', 'warning']

if (review.issues !== undefined && review.issues !== null) {
  if (!Array.isArray(review.issues)) {
    errors.push('issues 非数组')
  } else {
    for (const issue of review.issues) {
      if (!issue.target) errors.push(`issue 缺少 target: ${JSON.stringify(issue).slice(0, 80)}`)
      if (!TYPES.includes(issue.type)) errors.push(`issue type "${issue.type}" 不在枚举中`)
      if (!SEVERITIES.includes(issue.severity)) errors.push(`issue severity "${issue.severity}" 不在枚举中`)
      if (!issue.message || String(issue.message).trim().length === 0) {
        errors.push(`issue(${issue.target || '?'}) message 为空`)
      }
    }
  }
}

// 4. blocker 与 verdict 一致性：有 blocker 时 verdict 不得为 pass
const blockers = (review.issues || []).filter(i => i.severity === 'blocker')
if (review.verdict === 'pass' && blockers.length > 0) {
  errors.push(`有 ${blockers.length} 个 blocker 但 verdict=pass，矛盾`)
}
if ((review.verdict === 'fix' || review.verdict === 'clarify') && blockers.length === 0) {
  errors.push(`verdict=${review.verdict} 但没有任何 blocker`)
}

// 5. target 引用的 ID 必须存在于 spec（spec 整体问题 target="spec" 除外）
if (existsSync(specFile)) {
  const specContent = readFileSync(specFile, 'utf-8')
  const parsed = parseSpec(specContent)
  const knownIds = new Set([...parsed.frIds, ...parsed.nfrIds, ...parsed.acIds])
  for (const issue of (review.issues || [])) {
    if (issue.target && issue.target !== 'spec' && !knownIds.has(issue.target)) {
      errors.push(`issue target "${issue.target}" 在 spec.md 中不存在`)
    }
  }
}

// 输出
if (errors.length > 0) {
  console.error('[FAIL] ears-review.json 结构非法:')
  errors.forEach(e => console.error(`  - ${e}`))
  // --expect 模式：结构非法仅在期望 invalid 时返回 0
  process.exit(expectMode ? (expectMode === 'invalid' ? 0 : 1) : 1)
}

const code = exitFor[review.verdict]
const summary = {
  verdict: review.verdict,
  blockers: blockers.length,
  warnings: (review.issues || []).filter(i => i.severity === 'warning').length
}
console.log(JSON.stringify(summary))
process.exit(expectMode ? (expectMode === review.verdict ? 0 : 1) : code)
