#!/usr/bin/env node
// validate-chunks.mjs — Chunk 结构完整性校验器（LPRD-P0，确定性）
// 用法: node sdd/tools/validate-chunks.mjs <feature> [--json]
//       node sdd/tools/validate-chunks.mjs <feature> --exists CHUNK-001   （探针模式：chunk 在 manifest 中退出 0）
// 退出码: 0=通过/存在, 1=失败/不存在
// 检查：prdHash、主覆盖区间完整无缺口无重叠、overlap 后缀一致性、Chunk 文件字节级切片一致、
//       oversize 只能由原子块超预算产生、chunks 目录无多余文件

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'

const args = process.argv.slice(2)
const feature = args[0] && !args[0].startsWith('--') ? args[0] : null
const jsonMode = args.includes('--json')
const existsIdx = args.indexOf('--exists')
const probeChunk = existsIdx >= 0 ? args[existsIdx + 1] : null

if (!feature || (probeChunk === null && jsonMode === false && args.length > 1 && !['--json'].includes(args[1]) && existsIdx < 0)) {
  // 宽松处理：只有 feature 必需
}
if (!feature) {
  console.error('Usage: node sdd/tools/validate-chunks.mjs <feature> [--json] | --exists CHUNK-NNN')
  process.exit(1)
}

const dir = resolve('specs', feature)
const prdFile = resolve(dir, 'source-prd.md')
const manifestFile = resolve(dir, 'intake', 'manifest.json')
const chunksDir = resolve(dir, 'intake', 'chunks')

function sha256(text) {
  return 'sha256-' + createHash('sha256').update(text).digest('hex')
}

function readFileText(path) {
  let content = readFileSync(path, 'utf-8')
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1)
  return content
}

// --- 探针模式：供工作流循环判断 chunk 是否存在 ---
if (probeChunk) {
  if (!existsSync(manifestFile)) process.exit(1)
  try {
    const m = JSON.parse(readFileText(manifestFile))
    process.exit(m.chunks.some(c => c.chunkId === probeChunk) ? 0 : 1)
  } catch {
    process.exit(1)
  }
}

const errors = []

if (!existsSync(prdFile)) {
  console.error(`[FAIL] source-prd.md 不存在: ${prdFile}`)
  process.exit(1)
}
if (!existsSync(manifestFile)) {
  console.error(`[FAIL] manifest.json 不存在: ${manifestFile}`)
  process.exit(1)
}
if (!existsSync(chunksDir)) {
  console.error(`[FAIL] chunks 目录不存在: ${chunksDir}`)
  process.exit(1)
}

const prdContent = readFileSync(prdFile, 'utf-8')
const prdLines = prdContent.split('\n')
const manifest = JSON.parse(readFileText(manifestFile))

// 1. prdHash
const actualPrdHash = sha256(prdContent)
if (manifest.prdHash !== actualPrdHash) {
  errors.push(`prdHash 不匹配（原文被改写或 manifest 过期）`)
}

// 2. 主覆盖完整性：按 lineStart 排序后恰为 1..totalLines
const chunks = [...(manifest.chunks || [])].sort((a, b) => a.lineStart - b.lineStart)
if (chunks.length === 0) {
  errors.push('manifest 无 chunk')
} else {
  if (chunks[0].lineStart !== 1) {
    errors.push(`首个 Chunk lineStart=${chunks[0].lineStart}，应为 1（主覆盖有缺口）`)
  }
  for (let i = 1; i < chunks.length; i++) {
    if (chunks[i].lineStart !== chunks[i - 1].lineEnd + 1) {
      errors.push(`主覆盖不连续: ${chunks[i - 1].chunkId}(${chunks[i - 1].lineEnd}) 与 ${chunks[i].chunkId}(${chunks[i].lineStart})`)
    }
  }
  const last = chunks[chunks.length - 1]
  if (last.lineEnd !== prdLines.length) {
    errors.push(`末 Chunk lineEnd=${last.lineEnd}，应为 ${prdLines.length}（主覆盖未覆盖全文）`)
  }
}
if (manifest.totalLines !== prdLines.length) {
  errors.push(`manifest.totalLines=${manifest.totalLines} 与原文 ${prdLines.length} 不一致`)
}

// 3. 逐 Chunk：字节级切片 + 哈希 + overlap 后缀一致性 + oversize 语义
const seenIds = new Set()
for (const c of chunks) {
  const prefix = `${c.chunkId}: `
  if (seenIds.has(c.chunkId)) errors.push(`chunkId 重复: ${c.chunkId}`)
  seenIds.add(c.chunkId)

  const fileStart = (c.overlapStart !== null && c.overlapStart !== undefined) ? c.overlapStart : c.lineStart - 1
  const expected = prdLines.slice(fileStart, c.lineEnd).join('\n')
  const chunkFile = resolve(chunksDir, `${c.chunkId}.md`)
  if (!existsSync(chunkFile)) {
    errors.push(`${prefix}Chunk 文件不存在`)
    continue
  }
  const actual = readFileSync(chunkFile, 'utf-8')
  if (actual !== expected) {
    errors.push(`${prefix}Chunk 文件与原文切片不一致（字节级）`)
  }
  if (c.hash !== sha256(actual)) {
    errors.push(`${prefix}hash 与 Chunk 文件不匹配`)
  }

  if (c.oversize === true) {
    if (!(c.estTokens > manifest.params.budget)) {
      errors.push(`${prefix}oversize 标记但 estTokens(${c.estTokens}) 未超 budget(${manifest.params.budget})`)
    }
  }
}

// 4. overlap 一致性：overlapStart 落在前一 Chunk 主区间内（前缀区是前块尾部）
for (let i = 1; i < chunks.length; i++) {
  const c = chunks[i]
  if (c.overlapStart === null || c.overlapStart === undefined) continue
  const prev = chunks[i - 1]
  if (c.lineStart !== prev.lineEnd + 1) continue // 覆盖错误已报
  if (c.overlapStart < prev.lineStart || c.overlapStart > prev.lineEnd) {
    errors.push(`${c.chunkId}: overlapStart=${c.overlapStart} 不在前一 Chunk 主区间 [${prev.lineStart}, ${prev.lineEnd}] 内`)
  }
  if (c.overlapStart >= c.lineStart) {
    errors.push(`${c.chunkId}: overlapStart 不小于自身主区间起点，非法`)
  }
}

// 5. chunks 目录无多余文件
const extra = readdirSync(chunksDir).filter(f => f.endsWith('.md') && !seenIds.has(f.replace(/\.md$/, '')))
if (extra.length > 0) {
  errors.push(`chunks 目录存在 manifest 未登记的文件: ${extra.join(', ')}`)
}

// --- 输出 ---
if (jsonMode) {
  console.log(JSON.stringify({
    valid: errors.length === 0,
    feature,
    stats: {
      chunks: chunks.length,
      totalLines: manifest.totalLines,
      oversize: chunks.filter(c => c.oversize).length,
      withOverlap: chunks.filter(c => c.overlapStart !== null && c.overlapStart !== undefined).length
    },
    errors
  }, null, 2))
} else if (errors.length === 0) {
  console.log('[OK] Chunk 结构校验通过')
  console.log(`  Chunks: ${chunks.length} 个，主覆盖 1..${manifest.totalLines} 无缺口无重叠`)
  console.log(`  oversize: ${chunks.filter(c => c.oversize).length} 个，overlap 前缀: ${chunks.filter(c => c.overlapStart !== null && c.overlapStart !== undefined).length} 个`)
} else {
  console.error(`[FAIL] Chunk 校验失败（${errors.length} 处）:`)
  errors.forEach(e => console.error(`  - ${e}`))
}
process.exit(errors.length === 0 ? 0 : 1)
