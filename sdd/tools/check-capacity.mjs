#!/usr/bin/env node
// check-capacity.mjs — 大文档容量门禁（LPRD-P3，确定性）
// 用法: node sdd/tools/check-capacity.mjs <feature>
// 退出码: 0=通过, 1=超限（明确阻断，中间产物保留，禁止截断继续）
// 阈值来自 sdd/config.json 的 largePrd 节（缺省用默认值）

import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'

const feature = process.argv[2]
if (!feature) {
  console.error('Usage: node sdd/tools/check-capacity.mjs <feature>')
  process.exit(1)
}

const dir = resolve('specs', feature)
const manifestFile = join(dir, 'intake', 'manifest.json')
const sourceMapFile = join(dir, 'source-map.json')

const DEFAULTS = { maxClaims: 400, maxOversizeChunks: 0, maxTotalTokens: 300000 }

function tryReadJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf-8')) } catch { return null }
}

const config = tryReadJson(resolve('sdd', 'config.json')) || {}
const largePrd = { ...DEFAULTS, ...(config.largePrd || {}) }

if (!existsSync(manifestFile) || !existsSync(sourceMapFile)) {
  console.error('[FAIL] manifest 或 source-map 不存在（先完成切块与合并）')
  process.exit(1)
}

const manifest = tryReadJson(manifestFile)
const sourceMap = tryReadJson(sourceMapFile)

const claimCount = (sourceMap.sources || []).length
const oversizeCount = (manifest.chunks || []).filter(c => c.oversize).length
const totalTokens = manifest.estTokensTotal || 0

const errors = []
if (claimCount > largePrd.maxClaims) {
  errors.push(`Claim 总数 ${claimCount} 超过 maxClaims=${largePrd.maxClaims}（建议拆分为多个 Feature）`)
}
if (oversizeCount > largePrd.maxOversizeChunks) {
  errors.push(`oversize Chunk ${oversizeCount} 个超过 maxOversizeChunks=${largePrd.maxOversizeChunks}（存在超单次处理容量的原子块）`)
}
if (totalTokens > largePrd.maxTotalTokens) {
  errors.push(`estTokensTotal ${totalTokens} 超过 maxTotalTokens=${largePrd.maxTotalTokens}`)
}

const report = {
  feature,
  passed: errors.length === 0,
  limits: largePrd,
  usage: { claimCount, oversizeCount, totalTokens, chunkCount: (manifest.chunks || []).length }
}

writeFileSync(join(dir, 'intake', 'capacity-report.json'), JSON.stringify(report, null, 2) + '\n', 'utf-8')

if (errors.length > 0) {
  console.error('[FAIL] 容量门禁未通过（中间产物已保留于 intake/，禁止截断后继续）:')
  errors.forEach(e => console.error(`  - ${e}`))
  process.exit(1)
}
console.log(`[OK] 容量门禁通过（Claim ${claimCount}/${largePrd.maxClaims}，oversize ${oversizeCount}/${largePrd.maxOversizeChunks}，tokens ${totalTokens}/${largePrd.maxTotalTokens}）`)
process.exit(0)
