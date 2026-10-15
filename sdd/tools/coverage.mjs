#!/usr/bin/env node
// coverage.mjs — Coverage Gate: 验证 spec ID 集合 == traceability ID 集合
// 用法: node sdd/tools/coverage.mjs <feature>
// 退出码: 0=通过, 1=未达标
// 检查规则见 dev-docs/design/sdd-artifact-contract.md 第 3.4 节
// EARS-P0 改造：统一使用 spec-parser.mjs 解析；NFR 必须有 AC 映射；AC 归属校验

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { parseSpec, allACIds } from './spec-parser.mjs'

// 读取文件并去除 BOM
function readFile(path) {
  let content = readFileSync(path, 'utf-8')
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1)
  return content
}

const feature = process.argv[2]
if (!feature) {
  console.error('Usage: node coverage.mjs <feature>')
  process.exit(1)
}

const dir = resolve('specs', feature)
const specFile = resolve(dir, 'spec.md')
const tasksFile = resolve(dir, 'tasks.md')
const traceFile = resolve(dir, 'traceability.json')

const errors = []

// 1. 文件存在性
for (const [name, file] of [['spec.md', specFile], ['tasks.md', tasksFile], ['traceability.json', traceFile]]) {
  if (!existsSync(file)) {
    errors.push(`${name} 不存在: ${file}`)
  }
}
if (errors.length > 0) {
  console.error('[FAIL] 文件缺失:')
  errors.forEach(e => console.error(`  ${e}`))
  process.exit(1)
}

// 2. 解析 spec.md（统一解析器）
const specContent = readFile(specFile)
const parsed = parseSpec(specContent)

const frIds = parsed.frIds
const nfrIds = parsed.nfrIds
const acIds = allACIds(parsed)
const frSet = new Set(frIds)
const acSet = new Set(acIds)
const nfrSet = new Set(nfrIds)
const acToReq = parsed.acToReq

// 3. ID 重复检查（含孤儿 AC）
{
  const allIds = [...frIds, ...nfrIds, ...acIds]
  const seen = new Set()
  const dupes = []
  for (const id of allIds) {
    if (seen.has(id)) dupes.push(id)
    seen.add(id)
  }
  if (dupes.length > 0) {
    errors.push(`ID 重复: ${[...new Set(dupes)].join(', ')}`)
  }
}

// 3.1 孤儿 AC（不归属任何需求）
if (parsed.orphanACs.length > 0) {
  errors.push(`存在不归属任何 FR/NFR 的 AC: ${parsed.orphanACs.map(o => o.id).join(', ')}`)
}

// 4. 解析 tasks.md 中的 T-NNN ID
const tasksContent = readFile(tasksFile)
const taskMatches = [...tasksContent.matchAll(/##\s+(T-\d{3})/g)]
const taskIds = new Set(taskMatches.map(m => m[1]))

// 5. 解析 traceability.json
let trace
try {
  trace = JSON.parse(readFile(traceFile))
} catch (e) {
  console.error(`[FAIL] traceability.json 解析失败: ${e.message}`)
  process.exit(1)
}

// 6. feature 名称一致性
if (trace.feature !== feature) {
  errors.push(`feature 不匹配: traceability=${trace.feature}, expected=${feature}`)
}

// 7. specHash 校验
const actualHash = 'sha256-' + createHash('sha256').update(specContent).digest('hex')
if (!trace.specHash) {
  errors.push('traceability.json 缺少 specHash 字段（请先运行 freeze-traceability.mjs）')
} else if (trace.specHash !== actualHash) {
  errors.push(`specHash 不匹配: traceability=${trace.specHash}, actual=${actualHash}`)
}

// 8. mappings 完整性
if (!Array.isArray(trace.mappings) || trace.mappings.length === 0) {
  errors.push('traceability.json mappings 为空或非数组')
} else {
  const mappedReqs = new Set(trace.mappings.map(m => m.requirementId))
  const mappedACs = new Set(trace.mappings.flatMap(m => m.acceptanceIds || []))

  // 所有 FR 必须有映射
  const unmappedFRs = [...frSet].filter(id => !mappedReqs.has(id))
  if (unmappedFRs.length > 0) {
    errors.push(`未映射的 FR: ${unmappedFRs.join(', ')}`)
  }

  // 所有 NFR 必须有映射（实现约束 + 验证方式）
  const unmappedNFRs = [...nfrSet].filter(id => !mappedReqs.has(id))
  if (unmappedNFRs.length > 0) {
    errors.push(`未映射的 NFR: ${unmappedNFRs.join(', ')}（非功能需求不能被静默跳过）`)
  }

  // 不存在多余的需求映射
  const knownReqs = new Set([...frSet, ...nfrSet])
  const extraReqs = [...mappedReqs].filter(id => !knownReqs.has(id))
  if (extraReqs.length > 0) {
    errors.push(`traceability 中有 spec 不存在的需求 ID: ${extraReqs.join(', ')}`)
  }

  // 所有 AC 必须被覆盖
  const unmappedACs = [...acSet].filter(id => !mappedACs.has(id))
  if (unmappedACs.length > 0) {
    errors.push(`未映射的 AC: ${unmappedACs.join(', ')}`)
  }

  // mapping 引用了 spec 中不存在的 AC（反向校验）
  const extraACs = [...mappedACs].filter(id => !acSet.has(id))
  if (extraACs.length > 0) {
    errors.push(`traceability 中有 spec 不存在的 AC: ${extraACs.join(', ')}`)
  }

  // taskId 存在性与 verificationMethod 校验 + AC 归属校验
  for (const m of trace.mappings) {
    if (!taskIds.has(m.taskId)) {
      errors.push(`taskId ${m.taskId}（${m.requirementId}）在 tasks.md 中不存在`)
    }
    if (!['test', 'manual'].includes(m.verificationMethod)) {
      errors.push(`mapping ${m.requirementId} 的 verificationMethod 无效: ${m.verificationMethod}`)
    }
    // EARS-P0：NFR 的 acceptanceIds 不允许为空（NFR 必须逐 AC 映射）
    if (nfrSet.has(m.requirementId) && (!m.acceptanceIds || m.acceptanceIds.length === 0)) {
      errors.push(`NFR ${m.requirementId} 的 acceptanceIds 为空（EARS 契约要求 NFR 逐 AC 映射）`)
    }
    // EARS-P0：acceptanceIds 中的 AC 必须归属该 requirement
    for (const acId of (m.acceptanceIds || [])) {
      const owner = acToReq[acId]
      if (owner && owner !== m.requirementId) {
        errors.push(`AC ${acId} 属于 ${owner}，不能映射到 ${m.requirementId}`)
      }
    }
  }
}

// 输出结果
if (errors.length > 0) {
  console.error('[FAIL] Coverage Gate 未达标:')
  errors.forEach(e => console.error(`  - ${e}`))
  process.exit(1)
}

const nfrACCount = nfrIds.reduce((sum, id) => {
  const req = parsed.requirements.find(r => r.id === id)
  return sum + (req ? req.acs.length : 0)
}, 0)

console.log('[OK] Coverage Gate 通过')
console.log(`  FR: ${frIds.length} 个, 全部映射`)
console.log(`  NFR: ${nfrIds.length} 个, 全部映射（含 ${nfrACCount} 条 NFR AC）`)
console.log(`  AC: ${acIds.length} 条, 全部覆盖且归属正确`)
console.log(`  Tasks: ${taskIds.size} 个, 全部存在`)
console.log(`  specHash: ${actualHash}`)
process.exit(0)
