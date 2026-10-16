#!/usr/bin/env node
// validate-claims.mjs — 块级 Claim 确定性校验（LPRD-P1）
// 用法: node sdd/tools/validate-claims.mjs <feature> [chunkId] [--json]
// 退出码: 0=通过, 1=失败（省略 chunkId 时校验全部已存在的 claims 文件）
// 检查：结构/枚举/localId 唯一、quote 逐字存在于 Chunk 文件且落在声明的相对行号区间内、行号不越界

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'

const args = process.argv.slice(2)
const feature = args[0] && !args[0].startsWith('--') ? args[0] : null
const chunkArg = args[1] && !args[1].startsWith('--') ? args[1] : null
const jsonMode = args.includes('--json')

if (!feature) {
  console.error('Usage: node sdd/tools/validate-claims.mjs <feature> [chunkId] [--json]')
  process.exit(1)
}

const dir = resolve('specs', feature)
const claimsDir = resolve(dir, 'intake', 'claims')
const chunksDir = resolve(dir, 'intake', 'chunks')
const manifestFile = resolve(dir, 'intake', 'manifest.json')

const CLAIM_TYPES = ['functional', 'constraint', 'exception', 'non-goal', 'assumption', 'decision']

function normalizeWs(s) {
  return String(s).replace(/\s+/g, ' ').trim()
}

if (!existsSync(claimsDir) || !existsSync(manifestFile)) {
  console.error('[FAIL] intake/claims 或 manifest 不存在（先运行 prd-chunker 与分块提取）')
  process.exit(1)
}

const manifest = JSON.parse(readFileSync(manifestFile, 'utf-8'))
const errors = []
const stats = { files: 0, claims: 0 }

// 目标文件：指定 chunkId 或全部
let files
if (chunkArg) {
  files = [`${chunkArg}.json`]
  if (!existsSync(join(claimsDir, files[0]))) {
    console.error(`[FAIL] claims 文件不存在: ${files[0]}`)
    process.exit(1)
  }
} else {
  files = readdirSync(claimsDir).filter(f => f.endsWith('.json')).sort()
  if (files.length === 0) {
    console.error('[FAIL] intake/claims 目录为空')
    process.exit(1)
  }
}

for (const f of files) {
  const chunkId = f.replace(/\.json$/, '')
  const entry = manifest.chunks.find(c => c.chunkId === chunkId)
  if (!entry) {
    errors.push(`${chunkId}: 不在 manifest 中`)
    continue
  }
  const chunkFile = join(chunksDir, `${chunkId}.md`)
  if (!existsSync(chunkFile)) {
    errors.push(`${chunkId}: Chunk 文件不存在`)
    continue
  }
  const chunkLines = readFileSync(chunkFile, 'utf-8').split('\n')

  let data
  try {
    data = JSON.parse(readFileSync(join(claimsDir, f), 'utf-8'))
  } catch (e) {
    errors.push(`${chunkId}: JSON 解析失败 ${e.message}`)
    continue
  }
  if (data.chunkId !== chunkId) {
    errors.push(`${chunkId}: 文件内 chunkId=${data.chunkId} 与文件名不符`)
  }
  if (!Array.isArray(data.claims)) {
    errors.push(`${chunkId}: claims 非数组`)
    continue
  }
  stats.files++
  stats.claims += data.claims.length

  const seenLocal = new Set()
  for (const c of data.claims) {
    const prefix = `${chunkId}/${c.localId || '?'}: `
    if (!c.localId || !/^L-\d{3}$/.test(c.localId)) {
      errors.push(`${prefix}localId 格式错误（应为 L-NNN）`)
      continue
    }
    if (seenLocal.has(c.localId)) errors.push(`${prefix}localId 重复`)
    seenLocal.add(c.localId)

    if (!c.text || String(c.text).trim().length === 0) errors.push(`${prefix}text 为空`)
    if (!CLAIM_TYPES.includes(c.claimType)) {
      errors.push(`${prefix}claimType "${c.claimType}" 不在六枚举中`)
    }
    if (typeof c.loadBearing !== 'boolean') errors.push(`${prefix}loadBearing 非布尔`)

    if (!Number.isInteger(c.lineStart) || !Number.isInteger(c.lineEnd) || c.lineStart < 1 || c.lineEnd < c.lineStart || c.lineEnd > chunkLines.length) {
      errors.push(`${prefix}行号区间非法（1..${chunkLines.length}）`)
      continue
    }
    if (!c.quote || String(c.quote).trim().length === 0) {
      errors.push(`${prefix}quote 为空`)
    } else {
      const rangeText = normalizeWs(chunkLines.slice(c.lineStart - 1, c.lineEnd).join(' '))
      if (!rangeText.includes(normalizeWs(c.quote))) {
        errors.push(`${prefix}quote 与 Chunk 文件 ${c.lineStart}..${c.lineEnd} 行不一致`)
      }
    }
  }
}

if (jsonMode) {
  console.log(JSON.stringify({ valid: errors.length === 0, feature, stats, errors }, null, 2))
} else if (errors.length === 0) {
  console.log(`[OK] 块级 Claim 校验通过（${stats.files} 个文件，${stats.claims} 条 Claim）`)
} else {
  console.error(`[FAIL] 块级 Claim 校验失败（${errors.length} 处）:`)
  errors.forEach(e => console.error(`  - ${e}`))
}
process.exit(errors.length === 0 ? 0 : 1)
