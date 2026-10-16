#!/usr/bin/env node
// validate-preservation.mjs — Gate B 确定性校验：preservation-review.json 结构/覆盖/证据/哈希/verdict
// 用法: node sdd/tools/validate-preservation.mjs <feature> [--expect pass|fix|clarify|invalid]
// 退出码:（无 --expect）0=pass, 2=fix, 3=clarify, 1=结构非法
//        （有 --expect）匹配退出 0，否则 1
// 只验结构、证据、覆盖与哈希，不判断 preserved 语义结论真伪（可信度靠 explore 独立性 + 证据可复核）
// 契约见 sdd/rules/claim-preservation.md 第二节 与 dev-docs/planning/EARS改造-P3-执行文档.md T06

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
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

function sha256Of(path) {
  return 'sha256-' + createHash('sha256').update(readFileSync(path, 'utf-8')).digest('hex')
}

const feature = process.argv.find((a, i) => i >= 2 && !a.startsWith('--'))
const expectIdx = process.argv.indexOf('--expect')
const expectMode = expectIdx >= 0 ? process.argv[expectIdx + 1] : null
if (!feature || (expectMode && !['pass', 'fix', 'clarify', 'invalid'].includes(expectMode))) {
  console.error('Usage: node sdd/tools/validate-preservation.mjs <feature> [--expect pass|fix|clarify|invalid]')
  process.exit(1)
}

const dir = resolve('specs', feature)
const reviewFile = resolve(dir, 'preservation-review.json')
const prdFile = resolve(dir, 'source-prd.md')
const specFile = resolve(dir, 'spec.md')
const mapFile = resolve(dir, 'source-map.json')

const errors = []
const exitFor = { pass: 0, fix: 2, clarify: 3 }

// --- 前置存在性 ---
for (const [name, file] of [['preservation-review.json', reviewFile], ['source-prd.md', prdFile], ['spec.md', specFile], ['source-map.json', mapFile]]) {
  if (!existsSync(file)) {
    console.error(`[FAIL] ${name} 不存在: ${file}`)
    process.exit(expectMode ? (expectMode === 'invalid' ? 0 : 1) : 1)
  }
}

const review = tryReadJson(reviewFile)
if (!review) {
  console.error('[FAIL] preservation-review.json JSON 解析失败')
  process.exit(expectMode ? (expectMode === 'invalid' ? 0 : 1) : 1)
}

// --- 1. 三哈希锚定（P3-07：过期 Review 拒绝） ---
if (review.prdHash !== sha256Of(prdFile)) errors.push('prdHash 与 source-prd.md 不匹配')
if (review.specHash !== sha256Of(specFile)) errors.push('specHash 与 spec.md 不匹配（Spec 已变更但审查未重跑，结论过期）')
if (review.sourceMapHash !== sha256Of(mapFile)) errors.push('sourceMapHash 与 source-map.json 不匹配')

// --- 2. 基本字段 ---
if (review.feature !== feature) errors.push(`feature 不匹配: review=${review.feature}, expected=${feature}`)
if (!['pass', 'fix', 'clarify'].includes(review.verdict)) {
  errors.push(`verdict "${review.verdict}" 不在枚举 pass|fix|clarify 中`)
}

// --- 3. claims 全覆盖 + 逐条结构 ---
const map = tryReadJson(mapFile)
const parsed = parseSpec(readFileSync(specFile, 'utf-8'))
const knownReqs = new Set([...parsed.frIds, ...parsed.nfrIds])
const specACByReq = new Map()
for (const req of parsed.requirements) specACByReq.set(req.id, new Set(req.acs.map(a => a.id)))

const srcIds = map && Array.isArray(map.sources) ? map.sources.map(s => s.sourceId) : []
const STATUSES = ['preserved', 'partial', 'missing', 'contradicted', 'uncertain', 'excluded']
// specEvidence 仅对指向真实 Spec 内容的状态强制（partial/contradicted）；missing/excluded/uncertain 无 Spec 侧可引
const SPEC_EVIDENCE_REQUIRED = ['partial', 'contradicted']

let blockers = 0
const claims = Array.isArray(review.claims) ? review.claims : null
if (!claims) {
  errors.push('claims 缺失或非数组')
} else {
  const reviewedSrc = new Set()
  for (const c of claims) {
    const prefix = `claim(${c.sourceId || '?'}): `
    if (!c.sourceId || !srcIds.includes(c.sourceId)) {
      errors.push(`${prefix}sourceId "${c.sourceId}" 不在 source-map 中`)
      continue
    }
    if (reviewedSrc.has(c.sourceId)) {
      errors.push(`${prefix}重复审查条目`)
      continue
    }
    reviewedSrc.add(c.sourceId)

    // status 枚举与证据
    if (!STATUSES.includes(c.status)) {
      errors.push(`${prefix}status "${c.status}" 不在六枚举 ${STATUSES.join('|')} 中`)
      continue
    }
    if (c.status !== 'preserved') {
      if (!c.sourceEvidence || String(c.sourceEvidence).trim().length === 0) {
        errors.push(`${prefix}status=${c.status} 但 sourceEvidence 为空`)
      }
      if (SPEC_EVIDENCE_REQUIRED.includes(c.status) && (!c.specEvidence || String(c.specEvidence).trim().length === 0)) {
        errors.push(`${prefix}status=${c.status} 但 specEvidence 为空（需引用 Spec 原文）`)
      }
      if (!c.finding || String(c.finding).trim().length === 0) {
        errors.push(`${prefix}status=${c.status} 但 finding 为空`)
      }
    }
    if (!['blocker', 'warning'].includes(c.severity)) {
      errors.push(`${prefix}severity "${c.severity}" 不在枚举 blocker|warning 中`)
    } else if (c.severity === 'blocker') {
      blockers++
    }

    // 引用存在性与归属
    const reqIds = c.requirementIds || []
    const acIds = c.acceptanceIds || []
    for (const r of reqIds) {
      if (!knownReqs.has(r)) errors.push(`${prefix}requirementId "${r}" 在 spec.md 中不存在`)
    }
    for (const a of acIds) {
      const owner = parsed.acToReq[a]
      if (!owner) {
        errors.push(`${prefix}acceptanceId "${a}" 在 spec.md 中不存在`)
      } else if (reqIds.length > 0 && !reqIds.includes(owner)) {
        errors.push(`${prefix}AC ${a} 属于 ${owner}，不在本 claim 的 requirementIds 中`)
      }
    }
  }

  // 全覆盖：source-map 的每个 SRC 必须被审查
  for (const id of srcIds) {
    if (!reviewedSrc.has(id)) {
      errors.push(`SRC ${id} 未被审查（claims 必须覆盖全部 SRC，缺失即失败）[missing-claim]`)
    }
  }
}

// --- 4. verdict 一致性 ---
if (!errors.some(e => e.includes('verdict') && e.includes('枚举'))) {
  const hasBlocker = blockers > 0 || errors.some(e => e.includes('[missing-claim]'))
  if (review.verdict === 'pass' && hasBlocker) {
    errors.push(`存在 ${blockers} 个 blocker 但 verdict=pass，矛盾`)
  }
  if ((review.verdict === 'fix' || review.verdict === 'clarify') && !hasBlocker) {
    errors.push(`verdict=${review.verdict} 但没有任何 blocker`)
  }
}

// --- 5. unsupportedRequirements ---
const unsupported = Array.isArray(review.unsupportedRequirements) ? review.unsupportedRequirements : null
if (!unsupported) {
  errors.push('unsupportedRequirements 缺失或非数组（可为空数组）')
} else {
  for (const item of unsupported) {
    const id = typeof item === 'string' ? item : item.id
    if (!id || !knownReqs.has(id)) {
      errors.push(`unsupportedRequirements 引用的 "${id}" 在 spec.md 中不存在`)
    }
  }
  if (unsupported.length > 0 && review.verdict === 'pass') {
    errors.push(`unsupportedRequirements 有 ${unsupported.length} 项但 verdict=pass，矛盾`)
  }
}

// --- 6. intakeFindings 结构 ---
if (review.intakeFindings !== undefined && review.intakeFindings !== null && !Array.isArray(review.intakeFindings)) {
  errors.push('intakeFindings 非数组')
}

// --- 输出 ---
if (errors.length > 0) {
  console.error(`[FAIL] preservation-review 校验失败（${errors.length} 处）:`)
  errors.forEach(e => console.error(`  - ${e}`))
  process.exit(expectMode ? (expectMode === 'invalid' ? 0 : 1) : 1)
}

const fixBlockers = claims ? claims.filter(c => c.severity === 'blocker' && ['partial', 'missing', 'contradicted'].includes(c.status)).length : 0
const clarifyBlockers = claims ? claims.filter(c => c.severity === 'blocker' && c.status === 'uncertain').length : 0
console.log(JSON.stringify({ verdict: review.verdict, claims: claims.length, fixBlockers, clarifyBlockers }))
process.exit(expectMode ? (expectMode === review.verdict ? 0 : 1) : exitFor[review.verdict])
