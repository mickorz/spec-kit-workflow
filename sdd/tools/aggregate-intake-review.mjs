#!/usr/bin/env node
// aggregate-intake-review.mjs — 聚合块级 Gate A 审查为现有 intake-review.json 契约（LPRD-P2）
// 用法: node sdd/tools/aggregate-intake-review.mjs <feature> [--expect pass|fix|invalid]
// 退出码:（无 --expect）0=pass, 2=fix, 1=失败；（有 --expect）匹配退出 0 否则 1
// 聚合规则：
//   1. manifest 全部 chunk 必须有 reviews/CHUNK-NNN.json 且结构合法（缺一块即失败——审查缺失不得成功）
//   2. missedClaim 视为已解决当且仅当其 quote 与该块 claims 文件中某条 Claim 的 quote 归一化相同（补漏后重聚，无需重审）
//   3. verdict=pass 当且仅当全部块 pass 且无未解决遗漏；否则 fix（遗漏转绝对行号 + chunkId 标记）
//   4. 产物写入 specs/<feature>/intake-review.json（EARS-P3 validate-intake-review 契约零改动复用）

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { checkChunkReview } from './validate-chunk-review.mjs'

const args = process.argv.slice(2)
const feature = args[0] && !args[0].startsWith('--') ? args[0] : null
const expectIdx = args.indexOf('--expect')
const expectMode = expectIdx >= 0 ? args[expectIdx + 1] : null

if (!feature || (expectMode && !['pass', 'fix', 'invalid'].includes(expectMode))) {
  console.error('Usage: node sdd/tools/aggregate-intake-review.mjs <feature> [--expect pass|fix|invalid]')
  process.exit(1)
}

const dir = resolve('specs', feature)
const intakeDir = join(dir, 'intake')
const manifestFile = join(intakeDir, 'manifest.json')
const prdFile = join(dir, 'source-prd.md')

function normalizeWs(s) {
  return String(s).replace(/\s+/g, ' ').trim()
}

if (!existsSync(manifestFile) || !existsSync(prdFile)) {
  console.error('[FAIL] manifest 或 source-prd.md 不存在')
  process.exit(expectMode ? (expectMode === 'invalid' ? 0 : 1) : 1)
}

const manifest = JSON.parse(readFileSync(manifestFile, 'utf-8'))
const prdHash = 'sha256-' + createHash('sha256').update(readFileSync(prdFile, 'utf-8')).digest('hex')

const errors = []
const aggregatedMissed = []
let allPass = true

for (const entry of manifest.chunks) {
  const chunkId = entry.chunkId
  const reviewFile = join(intakeDir, 'reviews', `${chunkId}.json`)
  if (!existsSync(reviewFile)) {
    errors.push(`${chunkId}: 审查文件缺失（审查缺失不得成功）`)
    continue
  }
  let review
  try {
    review = JSON.parse(readFileSync(reviewFile, 'utf-8'))
  } catch (e) {
    errors.push(`${chunkId}: 审查 JSON 解析失败 ${e.message}`)
    continue
  }
  const { errs } = checkChunkReview(feature, chunkId, review, manifest, join(intakeDir, 'chunks'))
  if (errs.length > 0) {
    errors.push(...errs.map(e => `${chunkId}: ${e}`))
    continue
  }
  // 注：verdict=fix 不直接置 allPass=false——若其全部 missedClaims 已被补漏（quote 匹配）则视为已解决

  // 已解决判定：quote 与该块 claims 中某条归一化相同
  const claimsFile = join(intakeDir, 'claims', `${chunkId}.json`)
  let claimQuotes = new Set()
  if (existsSync(claimsFile)) {
    try {
      const data = JSON.parse(readFileSync(claimsFile, 'utf-8'))
      claimQuotes = new Set((data.claims || []).map(c => normalizeWs(c.quote)))
    } catch { /* 块级校验已由 validate-claims 负责 */ }
  }

  // Chunk 文件起点（相对→绝对换算）
  const fileStart1 = (entry.overlapStart !== null && entry.overlapStart !== undefined) ? entry.overlapStart : entry.lineStart

  for (const mc of (review.missedClaims || [])) {
    if (claimQuotes.has(normalizeWs(mc.quote))) continue // 已补漏
    allPass = false
    aggregatedMissed.push({
      quote: mc.quote,
      lineStart: fileStart1 + mc.lineStart - 1,
      lineEnd: fileStart1 + mc.lineEnd - 1,
      suggestedClaimType: mc.suggestedClaimType,
      reason: mc.reason,
      chunkId
    })
  }
}

if (errors.length > 0) {
  console.error(`[FAIL] 聚合失败（${errors.length} 处）:`)
  errors.forEach(e => console.error(`  - ${e}`))
  process.exit(expectMode ? (expectMode === 'invalid' ? 0 : 1) : 1)
}

const verdict = allPass ? 'pass' : 'fix'
const aggregate = { feature, verdict, prdHash, missedClaims: aggregatedMissed }
writeFileSync(join(dir, 'intake-review.json'), JSON.stringify(aggregate, null, 2) + '\n', 'utf-8')

console.log(JSON.stringify({
  verdict,
  chunks: manifest.chunks.length,
  unresolvedMissed: aggregatedMissed.length
}))
process.exit(expectMode ? (expectMode === verdict ? 0 : 1) : (verdict === 'pass' ? 0 : 2))
