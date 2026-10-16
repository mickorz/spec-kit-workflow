#!/usr/bin/env node
// validate-intake-review.mjs — Gate A 确定性校验：intake-review.json 结构/引文/verdict 一致性
// 用法: node sdd/tools/validate-intake-review.mjs <feature> [--expect pass|fix|invalid]
// 退出码:（无 --expect）0=pass, 2=fix, 1=结构非法
//        （有 --expect）匹配退出 0，否则 1 —— 适配 workflow 的 commandSuccess 布尔原语
// 契约见 sdd/rules/claim-preservation.md 第一节

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'

function tryReadJson(path) {
  try {
    let content = readFileSync(path, 'utf-8')
    if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1)
    return JSON.parse(content)
  } catch {
    return null
  }
}

function normalizeWs(s) {
  return String(s).replace(/\s+/g, ' ').trim()
}

const feature = process.argv.find((a, i) => i >= 2 && !a.startsWith('--'))
const expectIdx = process.argv.indexOf('--expect')
const expectMode = expectIdx >= 0 ? process.argv[expectIdx + 1] : null
if (!feature || (expectMode && !['pass', 'fix', 'invalid'].includes(expectMode))) {
  console.error('Usage: node sdd/tools/validate-intake-review.mjs <feature> [--expect pass|fix|invalid]')
  process.exit(1)
}

const dir = resolve('specs', feature)
const reviewFile = resolve(dir, 'intake-review.json')
const prdFile = resolve(dir, 'source-prd.md')
const errors = []

const exitFor = { pass: 0, fix: 2 }

if (!existsSync(reviewFile)) {
  console.error('[FAIL] intake-review.json 不存在')
  process.exit(expectMode ? (expectMode === 'invalid' ? 0 : 1) : 1)
}

const review = tryReadJson(reviewFile)
if (!review) {
  console.error('[FAIL] intake-review.json JSON 解析失败')
  process.exit(expectMode ? (expectMode === 'invalid' ? 0 : 1) : 1)
}

// 1. 字段校验
if (review.feature !== feature) {
  errors.push(`feature 不匹配: review=${review.feature}, expected=${feature}`)
}
if (!['pass', 'fix'].includes(review.verdict)) {
  errors.push(`verdict "${review.verdict}" 不在枚举 pass|fix 中（Gate A 无 clarify：漏了就补）`)
}

// 2. prdHash 锚定
if (!existsSync(prdFile)) {
  errors.push('source-prd.md 不存在')
} else {
  const actual = 'sha256-' + createHash('sha256').update(readFileSync(prdFile, 'utf-8')).digest('hex')
  if (review.prdHash !== actual) {
    errors.push('prdHash 与 source-prd.md 不匹配（审查结论未锚定当前原文）')
  }
}

// 3. verdict 与 missedClaims 一致性
const missed = Array.isArray(review.missedClaims) ? review.missedClaims : null
if (!missed) {
  errors.push('missedClaims 缺失或非数组')
} else {
  if (review.verdict === 'pass' && missed.length > 0) {
    errors.push(`verdict=pass 但 missedClaims 有 ${missed.length} 条，矛盾`)
  }
  if (review.verdict === 'fix' && missed.length === 0) {
    errors.push('verdict=fix 但 missedClaims 为空，矛盾')
  }
  // 4. missedClaims 结构与引文存在性
  const CLAIM_TYPES = ['functional', 'constraint', 'exception', 'non-goal', 'assumption', 'decision']
  const prdText = existsSync(prdFile) ? normalizeWs(readFileSync(prdFile, 'utf-8')) : null
  for (const c of missed) {
    const prefix = `missedClaim${c.quote ? `(${String(c.quote).slice(0, 12)}...)` : ''}: `
    if (!c.quote || String(c.quote).trim().length === 0) {
      errors.push(`${prefix}quote 为空`)
    } else if (prdText && !prdText.includes(normalizeWs(c.quote))) {
      errors.push(`${prefix}quote 在 source-prd.md 中不存在（引文必须逐字来自原文）`)
    }
    if (!Number.isInteger(c.lineStart) || !Number.isInteger(c.lineEnd) || c.lineStart < 1 || c.lineEnd < c.lineStart) {
      errors.push(`${prefix}行号区间非法`)
    }
    if (!CLAIM_TYPES.includes(c.suggestedClaimType)) {
      errors.push(`${prefix}suggestedClaimType "${c.suggestedClaimType}" 不在六枚举中`)
    }
    if (!c.reason || String(c.reason).trim().length === 0) {
      errors.push(`${prefix}reason 为空`)
    }
  }
}

// 输出
if (errors.length > 0) {
  console.error('[FAIL] intake-review.json 结构非法:')
  errors.forEach(e => console.error(`  - ${e}`))
  process.exit(expectMode ? (expectMode === 'invalid' ? 0 : 1) : 1)
}

const summary = { verdict: review.verdict, missedClaims: (review.missedClaims || []).length }
console.log(JSON.stringify(summary))
process.exit(expectMode ? (expectMode === review.verdict ? 0 : 1) : exitFor[review.verdict])
