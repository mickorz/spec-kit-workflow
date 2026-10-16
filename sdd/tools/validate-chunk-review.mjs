#!/usr/bin/env node
// validate-chunk-review.mjs — 块级 Gate A 审查产物校验（LPRD-P2，确定性）
// 用法: node sdd/tools/validate-chunk-review.mjs <feature> [chunkId] [--expect pass|fix|invalid]
// 退出码:（无 --expect）0=pass, 2=fix, 1=结构非法；（有 --expect）匹配退出 0 否则 1
// 检查：chunkId 在 manifest、verdict 枚举与一致性、quote 逐字存在于 Chunk 文件且落在【主区间】相对行号内
//       （overlap 前缀行不算——遗漏责任块唯一）、suggestedClaimType 六枚举、reason 非空

import { readFileSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'

const args = process.argv.slice(2)
const feature = args[0] && !args[0].startsWith('--') ? args[0] : null
const chunkArg = args[1] && !args[1].startsWith('--') ? args[1] : null
const expectIdx = args.indexOf('--expect')
const expectMode = expectIdx >= 0 ? args[expectIdx + 1] : null

if (!feature || (expectMode && !['pass', 'fix', 'invalid'].includes(expectMode))) {
  console.error('Usage: node sdd/tools/validate-chunk-review.mjs <feature> [chunkId] [--expect pass|fix|invalid]')
  process.exit(1)
}

const dir = resolve('specs', feature)
const manifestFile = join(dir, 'intake', 'manifest.json')
const CLAIM_TYPES = ['functional', 'constraint', 'exception', 'non-goal', 'assumption', 'decision']

function normalizeWs(s) {
  return String(s).replace(/\s+/g, ' ').trim()
}

// 导出校验函数（供 aggregate-intake-review 复用）
export function checkChunkReview(featureName, chunkId, review, manifest, chunksDir) {
  const errs = []
  const entry = manifest.chunks.find(c => c.chunkId === chunkId)
  if (!entry) {
    errs.push(`chunkId ${chunkId} 不在 manifest 中`)
    return { errs, verdict: null }
  }
  const chunkFile = join(chunksDir, `${chunkId}.md`)
  if (!existsSync(chunkFile)) {
    errs.push(`Chunk 文件不存在: ${chunkId}.md`)
    return { errs, verdict: null }
  }
  const chunkLines = readFileSync(chunkFile, 'utf-8').split('\n')
  // Chunk 文件起点（1-based）：overlapStart 或 lineStart
  const fileStart1 = (entry.overlapStart !== null && entry.overlapStart !== undefined) ? entry.overlapStart : entry.lineStart
  // 主区间相对行号范围（Chunk 文件内）
  const primaryFirst = entry.lineStart - fileStart1 + 1
  const primaryLast = entry.lineEnd - fileStart1 + 1

  if (review.feature !== undefined && review.feature !== featureName) {
    errs.push(`feature 不匹配: ${review.feature}`)
  }
  if (!['pass', 'fix'].includes(review.verdict)) {
    errs.push(`verdict "${review.verdict}" 不在枚举 pass|fix 中`)
    return { errs, verdict: null }
  }
  const missed = review.missedClaims
  if (!Array.isArray(missed)) {
    errs.push('missedClaims 非数组')
    return { errs, verdict: review.verdict }
  }
  if (review.verdict === 'pass' && missed.length > 0) {
    errs.push(`verdict=pass 但 missedClaims 有 ${missed.length} 条，矛盾`)
  }
  if (review.verdict === 'fix' && missed.length === 0) {
    errs.push('verdict=fix 但 missedClaims 为空，矛盾')
  }
  for (const c of missed) {
    const prefix = `missedClaim(${String(c.quote || '').slice(0, 10)}...): `
    if (!c.quote || String(c.quote).trim().length === 0) {
      errs.push(`${prefix}quote 为空`)
      continue
    }
    if (!Number.isInteger(c.lineStart) || !Number.isInteger(c.lineEnd) || c.lineStart < primaryFirst || c.lineEnd > primaryLast) {
      errs.push(`${prefix}行号 ${c.lineStart}..${c.lineEnd} 不在主区间相对行号 [${primaryFirst}, ${primaryLast}] 内（overlap 前缀行不算责任块）`)
      continue
    }
    const rangeText = normalizeWs(chunkLines.slice(c.lineStart - 1, c.lineEnd).join(' '))
    if (!rangeText.includes(normalizeWs(c.quote))) {
      errs.push(`${prefix}quote 与 Chunk 文件 ${c.lineStart}..${c.lineEnd} 行不一致`)
    }
    if (!CLAIM_TYPES.includes(c.suggestedClaimType)) {
      errs.push(`${prefix}suggestedClaimType "${c.suggestedClaimType}" 不在六枚举中`)
    }
    if (!c.reason || String(c.reason).trim().length === 0) {
      errs.push(`${prefix}reason 为空`)
    }
  }
  return { errs, verdict: review.verdict }
}

// --- CLI 模式（仅直接执行时运行；作为模块导入时只提供 checkChunkReview） ---
import { fileURLToPath } from 'node:url'
const isMain = (() => {
  try { return fileURLToPath(import.meta.url) === resolve(process.argv[1] || '') } catch { return false }
})()

if (isMain) {
  const reviewFile = join(dir, 'intake', 'reviews', `${chunkArg}.json`)
  if (!existsSync(manifestFile)) {
    console.error('[FAIL] manifest 不存在')
    process.exit(expectMode ? (expectMode === 'invalid' ? 0 : 1) : 1)
  }
  if (!chunkArg || !existsSync(reviewFile)) {
    console.error(`[FAIL] 审查文件不存在: intake/reviews/${chunkArg}.json`)
    process.exit(expectMode ? (expectMode === 'invalid' ? 0 : 1) : 1)
  }

  let review
  try {
    review = JSON.parse(readFileSync(reviewFile, 'utf-8'))
  } catch (e) {
    console.error(`[FAIL] JSON 解析失败: ${e.message}`)
    process.exit(expectMode ? (expectMode === 'invalid' ? 0 : 1) : 1)
  }

  const manifest = JSON.parse(readFileSync(manifestFile, 'utf-8'))
  const { errs, verdict } = checkChunkReview(feature, chunkArg, review, manifest, join(dir, 'intake', 'chunks'))

  if (errs.length > 0) {
    console.error(`[FAIL] 块审查校验失败（${errs.length} 处）:`)
    errs.forEach(e => console.error(`  - ${e}`))
    process.exit(expectMode ? (expectMode === 'invalid' ? 0 : 1) : 1)
  }

  console.log(JSON.stringify({ chunkId: chunkArg, verdict, missedClaims: (review.missedClaims || []).length }))
  process.exit(expectMode ? (expectMode === verdict ? 0 : 1) : (verdict === 'pass' ? 0 : 2))
}
