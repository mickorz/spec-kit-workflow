#!/usr/bin/env node
// merge-claims.mjs — 全局 Claim 合并与 SRC 分配（LPRD-P1）
// 用法: node sdd/tools/merge-claims.mjs <feature> [--semantic <semanticReportPath>] [--expect ok|conflict|fail]
// 退出码: 0=合并成功, 2=存在未解决冲突, 1=失败
//        （--expect 模式：匹配期望退出 0 否则 1，适配 workflow 的 commandSuccess）
// 两种运行：
//   确定性部分（无 --semantic）：块级校验 → 相对行号转绝对 → quote 全文复核 → 完全重复归并
//     → SRC 分配 → 草稿 intake/draft-source-map.json + merge-report 骨架
//   语义部分（--semantic）：按 Merge Agent 的语义报告归并 → 最终 specs/<feature>/source-map.json + merge-report.json

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'

const args = process.argv.slice(2)
const feature = args[0] && !args[0].startsWith('--') ? args[0] : null
function argOf(name) {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : null
}
const semanticPath = argOf('--semantic')
const expectMode = argOf('--expect')

if (!feature || (expectMode && !['ok', 'conflict', 'fail'].includes(expectMode))) {
  console.error('Usage: node sdd/tools/merge-claims.mjs <feature> [--semantic <file>] [--expect ok|conflict|fail]')
  process.exit(1)
}

const dir = resolve('specs', feature)
const intakeDir = resolve(dir, 'intake')
const claimsDir = resolve(intakeDir, 'claims')
const prdFile = resolve(dir, 'source-prd.md')
const manifestFile = resolve(intakeDir, 'manifest.json')

const CLAIM_TYPES = ['functional', 'constraint', 'exception', 'non-goal', 'assumption', 'decision']

function normalizeWs(s) {
  return String(s).replace(/\s+/g, ' ').trim()
}
function sha256(t) {
  return 'sha256-' + createHash('sha256').update(t).digest('hex')
}
function fail(msg) {
  console.error(`[FAIL] ${msg}`)
  process.exit(expectMode ? (expectMode === 'fail' ? 0 : 1) : 1)
}

if (!existsSync(claimsDir) || !existsSync(manifestFile) || !existsSync(prdFile)) {
  fail('intake/claims、manifest 或 source-prd.md 不存在')
}

const manifest = JSON.parse(readFileSync(manifestFile, 'utf-8'))
const prdLines = readFileSync(prdFile, 'utf-8').split('\n')
const claimFiles = readdirSync(claimsDir).filter(f => f.endsWith('.json')).sort()
if (claimFiles.length === 0) fail('intake/claims 目录为空')

// --- 1. 读取全部块级 Claim（含结构校验） ---
const allClaims = [] // { ref: "L-001@CHUNK-001", chunkId, localId, chunkIndex, absLineStart, absLineEnd, text, claimType, loadBearing, quote }
const chunkOrder = new Map(manifest.chunks.map((c, i) => [c.chunkId, i]))

for (const f of claimFiles) {
  const chunkId = f.replace(/\.json$/, '')
  const entry = manifest.chunks.find(c => c.chunkId === chunkId)
  if (!entry) fail(`${chunkId} 不在 manifest 中`)
  const chunkLines = readFileSync(join(intakeDir, 'chunks', `${chunkId}.md`), 'utf-8').split('\n')
  const fileStart0 = (entry.overlapStart !== null && entry.overlapStart !== undefined) ? entry.overlapStart - 1 : entry.lineStart - 1
  let data
  try {
    data = JSON.parse(readFileSync(join(claimsDir, f), 'utf-8'))
  } catch (e) {
    fail(`${chunkId} JSON 解析失败: ${e.message}`)
  }
  for (const c of (data.claims || [])) {
    if (!/^L-\d{3}$/.test(c.localId || '')) fail(`${chunkId}: localId 格式错误 ${c.localId}`)
    if (!CLAIM_TYPES.includes(c.claimType)) fail(`${chunkId}/${c.localId}: claimType 枚举外`)
    if (typeof c.loadBearing !== 'boolean') fail(`${chunkId}/${c.localId}: loadBearing 非布尔`)
    // 块内校验：quote 在块内声明区间
    if (!Number.isInteger(c.lineStart) || !Number.isInteger(c.lineEnd) || c.lineStart < 1 || c.lineEnd > chunkLines.length) {
      fail(`${chunkId}/${c.localId}: 行号越界`)
    }
    if (!c.quote || !normalizeWs(chunkLines.slice(c.lineStart - 1, c.lineEnd).join(' ')).includes(normalizeWs(c.quote))) {
      fail(`${chunkId}/${c.localId}: quote 与 Chunk 文件不一致`)
    }
    // 相对 → 绝对行号（Chunk 文件起点 = overlapStart 或 lineStart）
    allClaims.push({
      ref: `${c.localId}@${chunkId}`,
      chunkId,
      chunkIndex: chunkOrder.get(chunkId),
      localId: c.localId,
      absLineStart: fileStart0 + c.lineStart,
      absLineEnd: fileStart0 + c.lineEnd,
      text: c.text,
      claimType: c.claimType,
      loadBearing: c.loadBearing,
      quote: c.quote
    })
  }
}

// --- 2. 完全重复归并（确定性）：quote 归一化相同 → 同组 ---
const groups = [] // { members: [claim...], semantic: false, reason }
{
  const byQuote = new Map()
  for (const cl of allClaims) {
    const key = normalizeWs(cl.quote)
    if (!byQuote.has(key)) byQuote.set(key, [])
    byQuote.get(key).push(cl)
  }
  for (const members of byQuote.values()) groups.push({ members, semantic: false, reason: members.length > 1 ? 'quote 完全相同（确定性归并）' : null })
}

// --- 3. 语义报告（可选） ---
let conflicts = []
let semanticGroups = []
if (semanticPath) {
  if (!existsSync(resolve(semanticPath))) fail(`语义报告不存在: ${semanticPath}`)
  let report
  try {
    report = JSON.parse(readFileSync(resolve(semanticPath), 'utf-8'))
  } catch (e) {
    fail(`语义报告 JSON 解析失败: ${e.message}`)
  }
  semanticGroups = report.duplicateGroups || []
  conflicts = (report.conflicts || []).map(cf => ({
    claims: cf.claims || [],
    description: cf.description || '',
    status: cf.status || 'unresolved'
  })).filter(cf => cf.status === 'unresolved')
  // 引用合法性：报告中的 ref 必须真实存在
  const knownRefs = new Set(allClaims.map(c => c.ref))
  for (const g of semanticGroups) {
    for (const r of [g.kept, ...(g.merged || [])]) {
      if (!knownRefs.has(r)) fail(`语义重复组引用不存在的 Claim: ${r}`)
    }
  }
  for (const cf of conflicts) {
    for (const r of cf.claims) {
      if (!knownRefs.has(r)) fail(`冲突引用不存在的 Claim: ${r}`)
    }
  }

  // 应用语义组：把 merged 并入 kept 的组（跨确定性组重建）
  const semanticMap = new Map() // member ref -> kept ref
  for (const g of semanticGroups) {
    for (const m of (g.merged || [])) semanticMap.set(m, g.kept)
  }
  // 重建组：以语义 kept 为根
  const rootOf = new Map()
  function findRoot(ref) {
    let r = ref
    const seen = new Set()
    while (semanticMap.has(r) && !seen.has(r)) { seen.add(r); r = semanticMap.get(r) }
    return r
  }
  const newGroups = new Map()
  for (const cl of allClaims) {
    const root = findRoot(cl.ref)
    if (!newGroups.has(root)) newGroups.set(root, [])
    newGroups.get(root).push(cl)
  }
  // 合并语义组与确定性组：从确定性组重建——同 root 的合为一组，root 不同但 quote 相同的也需合并
  // 简化：以 quote+root 双键做并查集式合并过于复杂；采用：先按 quote 归并，再按语义归并合并组
  const finalGroups = []
  {
    // 1) quote 相同的组
    const byQuoteGroups = new Map()
    for (const [, members] of newGroups) {
      const quoteKeys = [...new Set(members.map(m => normalizeWs(m.quote)))]
      const key = quoteKeys.sort().join('||')
      if (!byQuoteGroups.has(key)) byQuoteGroups.set(key, [])
      byQuoteGroups.get(key).push(...members)
    }
    // 2) 语义根相同的组也合并
    const byRootGroups = new Map()
    for (const [, members] of byQuoteGroups) {
      const roots = [...new Set(members.map(m => findRoot(m.ref)))]
      const key = roots.sort().join('||')
      if (!byRootGroups.has(key)) byRootGroups.set(key, [])
      byRootGroups.get(key).push(...members)
    }
    for (const [key, members] of byRootGroups) {
      const rootRef = key.split('||')[0]
      const rootClaim = members.find(m => m.ref === rootRef) || members[0]
      finalGroups.push({
        members,
        semantic: members.length > 1 && [...new Set(members.map(m => normalizeWs(m.quote)))].length > 1,
        reason: members.length > 1
          ? ([...new Set(members.map(m => normalizeWs(m.quote)))].length > 1 ? '语义重复（Merge Agent 判定）' : 'quote 完全相同（确定性归并）')
          : null,
        rootRef: rootClaim.ref
      })
    }
  }
  groups.length = 0
  groups.push(...finalGroups)
}

// --- 4. 冲突 Claim 不参与 SRC 分配 ---
const conflictRefs = new Set(conflicts.flatMap(cf => cf.claims))

// --- 5. SRC 分配：组代表按（chunkIndex, absLineStart, localId）排序 ---
const assignable = groups.filter(g => !g.members.some(m => conflictRefs.has(m.ref)))
assignable.sort((a, b) => {
  const ra = a.members[0], rb = b.members[0]
  return ra.chunkIndex - rb.chunkIndex || ra.absLineStart - rb.absLineStart || ra.localId.localeCompare(rb.localId)
})

const sources = []
const srcAssignments = []
assignable.forEach((g, i) => {
  const rep = g.members[0]
  // 全文复核：绝对行号区间必须包含 quote（防 overlap 换算缺陷）
  const rangeText = normalizeWs(prdLines.slice(rep.absLineStart - 1, rep.absLineEnd).join(' '))
  if (!rangeText.includes(normalizeWs(rep.quote))) {
    fail(`全文复核失败: ${rep.ref} 绝对行号 ${rep.absLineStart}..${rep.absLineEnd} 不含 quote（换算缺陷拦截）`)
  }
  const sourceId = `SRC-${String(i + 1).padStart(3, '0')}`
  sources.push({
    sourceId,
    text: rep.text,
    status: 'confirmed',
    claimType: rep.claimType,
    loadBearing: rep.loadBearing,
    sourceRef: { file: 'source-prd.md', lineStart: rep.absLineStart, lineEnd: rep.absLineEnd, quote: rep.quote }
  })
  srcAssignments.push({
    sourceId,
    from: rep.ref,
    alsoFrom: g.members.slice(1).map(m => m.ref)
  })
})

// --- 6. provenance 守恒：局部 ID 总数 = kept + alsoFrom + 冲突未分配 ---
{
  const keptCount = srcAssignments.length
  const alsoCount = srcAssignments.reduce((s, a) => s + a.alsoFrom.length, 0)
  const conflictCount = [...conflictRefs].length
  if (keptCount + alsoCount + conflictCount !== allClaims.length) {
    fail(`provenance 不守恒: ${keptCount}+${alsoCount}+${conflictCount} != ${allClaims.length}`)
  }
}

// --- 7. 产物 ---
const unresolvedConflicts = conflicts.length
const mergeReport = {
  feature,
  duplicateGroups: groups.filter(g => g.members.length > 1).map(g => ({
    kept: g.members[0].ref,
    merged: g.members.slice(1).map(m => m.ref),
    reason: g.reason
  })),
  conflicts,
  srcAssignments,
  unresolvedConflicts
}

if (!semanticPath) {
  // 确定性部分：写草稿 + 骨架
  writeFileSync(resolve(intakeDir, 'draft-source-map.json'), JSON.stringify({
    feature, prdHash: manifest.prdHash, sources, mappings: []
  }, null, 2) + '\n', 'utf-8')
  writeFileSync(resolve(intakeDir, 'merge-report.json'), JSON.stringify(mergeReport, null, 2) + '\n', 'utf-8')
  console.log(`[OK] 确定性合并完成（草稿）: ${sources.length} SRC（来自 ${allClaims.length} 条局部 Claim，完全重复归并 ${mergeReport.duplicateGroups.length} 组）`)
  console.log('     待 Merge Agent 语义报告后运行 --semantic 生成正式 source-map')
  process.exit(0)
}

// 语义部分：写正式 source-map.json
writeFileSync(resolve(dir, 'source-map.json'), JSON.stringify({
  feature, prdHash: manifest.prdHash, sources, mappings: []
}, null, 2) + '\n', 'utf-8')
writeFileSync(resolve(intakeDir, 'merge-report.json'), JSON.stringify(mergeReport, null, 2) + '\n', 'utf-8')

if (unresolvedConflicts > 0) {
  console.error(`[CONFLICT] 合并完成但存在 ${unresolvedConflicts} 个未解决冲突（不参与 SRC 分配，需人工裁决后重跑语义合并）`)
  console.error(conflicts.map(c => `  - ${c.claims.join(' vs ')}: ${c.description}`).join('\n'))
  process.exit(expectMode ? (expectMode === 'conflict' ? 0 : 1) : 2)
}
console.log(`[OK] 语义合并完成: ${sources.length} SRC 写入 source-map.json（去重 ${mergeReport.duplicateGroups.length} 组，无未解决冲突）`)
process.exit(expectMode ? (expectMode === 'ok' ? 0 : 1) : 0)
