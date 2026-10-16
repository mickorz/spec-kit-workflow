#!/usr/bin/env node
// prd-chunker.mjs — 超长 PRD 结构化切块器（LPRD-P0，纯确定性，无 LLM）
// 用法: node sdd/tools/prd-chunker.mjs <feature> --from <prdPath> [--budget 3000] [--overlap 1] [--force]
// 退出码: 0=成功, 1=失败
// 步骤：
//   1. 原文字节级复制到 specs/<feature>/source-prd.md（不经 LLM），计算 prdHash
//   2. Markdown 标题树 → 章节正文按空行切原子块（围栏/表格/列表天然整块）
//   3. 章节内贪心装包（est-tokens 预算）；原子块超预算 → 独立 oversize 块，绝不截断
//   4. 产出 intake/manifest.json + intake/chunks/CHUNK-NNN.md（原文字节级切片）
// 规则见 sdd/rules/large-prd-intake.md 与 dev-docs/planning/LPRD-P0-执行文档.md

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs'
import { resolve, basename } from 'node:path'
import { createHash } from 'node:crypto'

const args = process.argv.slice(2)
const feature = args[0] && !args[0].startsWith('--') ? args[0] : null
function argOf(name, fallback) {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : fallback
}
const prdPath = argOf('--from', null)
const budget = parseInt(argOf('--budget', '3000'), 10)
const overlap = parseInt(argOf('--overlap', '1'), 10)
const force = args.includes('--force')

if (!feature || !prdPath) {
  console.error('Usage: node sdd/tools/prd-chunker.mjs <feature> --from <prdPath> [--budget 3000] [--overlap 1] [--force]')
  process.exit(1)
}

const srcPrd = resolve('specs', feature, 'source-prd.md')
const intakeDir = resolve('specs', feature, 'intake')
const manifestFile = resolve(intakeDir, 'manifest.json')
const chunksDir = resolve(intakeDir, 'chunks')

if (!existsSync(resolve(prdPath))) {
  console.error(`[FAIL] PRD 文件不存在: ${prdPath}`)
  process.exit(1)
}
if (existsSync(manifestFile) && !force) {
  console.error(`[FAIL] manifest 已存在（提取可能已开始），拒绝重切；确认后加 --force: ${manifestFile}`)
  process.exit(1)
}

// 1. 原文字节级复制（不做任何改写）
mkdirSync(resolve('specs', feature), { recursive: true })
const raw = readFileSync(resolve(prdPath))
writeFileSync(srcPrd, raw)
const prdHash = 'sha256-' + createHash('sha256').update(raw).digest('hex')

const content = raw.toString('utf-8')
const lines = content.split('\n')
const totalLines = lines.length
if (totalLines === 1 && lines[0].trim() === '') {
  console.error('[FAIL] PRD 为空文件')
  process.exit(1)
}

// 2. 标题解析（围栏内不算标题）
function isFenceLine(line) {
  return /^\s*(```|~~~)/.test(line)
}
const headings = [] // { lineIdx(0-based), level, text }
let inFence = false
for (let i = 0; i < totalLines; i++) {
  const line = lines[i]
  if (isFenceLine(line)) { inFence = !inFence; continue }
  if (inFence) continue
  const m = line.match(/^(#{1,6})\s*(.*)$/)
  if (m) headings.push({ lineIdx: i, level: m[1].length, text: m[2].trim() })
}

// 章节划分：相邻标题之间的内容为一个 section（含标题行自身）
// 每段 [startLineIdx, endLineIdxExclusive)，首个 section 从 0 开始（可能是无标题前言）
const sections = []
{
  const bounds = headings.map(h => h.lineIdx)
  const starts = [0, ...bounds]
  for (let s = 0; s < starts.length; s++) {
    const start = starts[s]
    const end = s + 1 < starts.length ? starts[s + 1] : totalLines
    if (end <= start) continue
    const h = s === 0 ? null : headings[s - 1]
    sections.push({ heading: h, start, end })
  }
}

// 标题栈 → sectionPath
function sectionPathFor(heading) {
  if (!heading) return []
  const stack = []
  for (const h of headings) {
    if (h.lineIdx >= heading.lineIdx) break
    while (stack.length >= h.level) stack.pop()
    stack[h.level - 1] = h.text
  }
  while (stack.length >= heading.level) stack.pop()
  stack[heading.level - 1] = heading.text
  return stack.filter(Boolean)
}

// 3. 原子块切分（空行分隔；围栏内空行不切）
function splitBlocks(start, end) {
  const blocks = []
  let current = null
  let fence = false
  for (let i = start; i < end; i++) {
    const line = lines[i]
    if (isFenceLine(line)) fence = !fence
    const blank = !fence && line.trim() === ''
    if (blank) {
      if (current) { blocks.push(current); current = null }
      continue
    }
    if (!current) current = { start: i, end: i + 1 }
    else current.end = i + 1
  }
  if (current) blocks.push(current)
  return blocks
}

// est-tokens 保守估算：CJK 全角 1，其他 0.25
function estTokensOfRange(start, endExclusive) {
  let est = 0
  for (let i = start; i < endExclusive; i++) {
    for (const ch of lines[i]) {
      est += ch.codePointAt(0) > 0x2e80 ? 1 : 0.25
    }
  }
  return Math.ceil(est)
}

// 4. 贪心装包（Chunk 严格划分所属 section 的完整行区间：块间空行归前一 Chunk，保证主覆盖无缺口）
const chunks = []
for (const sec of sections) {
  const blocks = splitBlocks(sec.start, sec.end)
  const path = sectionPathFor(sec.heading)
  let packed = []       // 本 chunk 的主块
  let packedEst = 0
  let prevChunkLastBlock = null // 上一 chunk 的末块（同章节内供 overlap）

  const flush = (endExclusive) => {
    if (packed.length === 0) return
    const first = packed[0]
    // chunk 覆盖 [chunkStartIdx, endExclusive)：起于本 chunk 首块，止于下一 chunk 首块之前（含尾随空行）
    const est = packedEst
    const oversize = est > budget
    let overlapStart = null
    if (prevChunkLastBlock && overlap > 0 && chunks.length > 0) {
      overlapStart = prevChunkLastBlock.start + 1 // 1-based
    }
    chunks.push({
      chunkId: `CHUNK-${String(chunks.length + 1).padStart(3, '0')}`,
      sectionPath: path,
      overlapStart,
      lineStart: chunkStartIdx + 1,
      lineEnd: endExclusive,
      estTokens: est,
      hash: null,
      oversize
    })
    prevChunkLastBlock = packed[packed.length - 1]
    packed = []
    packedEst = 0
    chunkStartIdx = endExclusive // 下一 chunk 从切点开始（含本 chunk 未归属的空行后首块）
  }

  let chunkStartIdx = sec.start // 本 chunk 主区间起点（首个 chunk 含 section 起始的空行等）
  for (let bi = 0; bi < blocks.length; bi++) {
    const block = blocks[bi]
    const blockEst = estTokensOfRange(block.start, block.end)
    if (packed.length > 0 && packedEst + blockEst > budget) {
      flush(block.start) // 切到下一块起始行前（空行归本 chunk）
    }
    packed.push(block)
    packedEst += blockEst
    if (blockEst > budget) {
      // 原子块自身超预算：独立成块标记 oversize，绝不从中间切开
      flush(block.end)
    }
  }
  flush(sec.end)
  // 段尾剩余行归属：packed 已空但切点未到段尾（如 oversize flush 之后），归入本段最后一个 Chunk；
  // 整段无块（纯空行前言段）则生成空 Chunk —— 保证主覆盖无缺口
  if (chunkStartIdx < sec.end) {
    const last = chunks[chunks.length - 1]
    if (last && last.sectionPath.join('/') === path.join('/')) {
      last.lineEnd = sec.end
    } else {
      chunks.push({
        chunkId: `CHUNK-${String(chunks.length + 1).padStart(3, '0')}`,
        sectionPath: path,
        overlapStart: null,
        lineStart: chunkStartIdx + 1,
        lineEnd: sec.end,
        estTokens: 0,
        hash: null,
        oversize: false
      })
    }
  }
}

// 跨章节不携带 overlap
for (let i = 1; i < chunks.length; i++) {
  if (chunks[i].overlapStart !== null && chunks[i].sectionPath.join('/') !== chunks[i - 1].sectionPath.join('/')) {
    chunks[i].overlapStart = null
  }
}

// 5. 写产物
rmSync(chunksDir, { recursive: true, force: true })
mkdirSync(chunksDir, { recursive: true })

for (const c of chunks) {
  const fileStart = (c.overlapStart !== null ? c.overlapStart : c.lineStart - 1)
  const text = lines.slice(fileStart, c.lineEnd).join('\n')
  c.hash = 'sha256-' + createHash('sha256').update(text).digest('hex')
  writeFileSync(resolve(chunksDir, `${c.chunkId}.md`), text, 'utf-8')
}

const estTokensTotal = chunks.reduce((s, c) => s + c.estTokens, 0)
const manifest = {
  feature,
  source: basename(prdPath),
  prdHash,
  totalLines,
  estTokensTotal,
  chunkCount: chunks.length,
  params: { budget, overlap },
  chunks
}
writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n', 'utf-8')

console.log(`[OK] 已切块: ${chunks.length} 个 Chunk（总 ${totalLines} 行，est ${estTokensTotal} tokens，budget ${budget}，overlap ${overlap}）`)
console.log(`     oversize: ${chunks.filter(c => c.oversize).length} 个`)
console.log(`     source-prd.md prdHash=${prdHash.slice(0, 24)}...`)
process.exit(0)
