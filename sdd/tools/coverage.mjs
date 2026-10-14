#!/usr/bin/env node
// coverage.mjs — Coverage Gate: 验证 spec ID 集合 == traceability ID 集合
// 用法: node sdd/tools/coverage.mjs <feature>
// 退出码: 0=通过, 1=未达标
// 检查规则见 dev-docs/design/sdd-artifact-contract.md 第 3.4 节

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'

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

// 2. 解析 spec.md 中的 FR、AC、NFR ID
const specContent = readFile(specFile)
const frMatches = [...specContent.matchAll(/###\s+(FR-\d{3})/g)]
const acMatches = [...specContent.matchAll(/-\s+(AC-\d{3})/g)]
const nfrMatches = [...specContent.matchAll(/###\s+(NFR-\d{3})/g)]

const frIds = frMatches.map(m => m[1])
const acIds = acMatches.map(m => m[1])
const nfrIds = nfrMatches.map(m => m[1])
const frSet = new Set(frIds)
const acSet = new Set(acIds)
const nfrSet = new Set(nfrIds)

// 3. ID 重复检查
for (const [label, ids, set] of [['FR', frIds, frSet], ['AC', acIds, acSet], ['NFR', nfrIds, nfrSet]]) {
  if (ids.length !== set.size) {
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i)
    errors.push(`${label} ID 重复: ${[...new Set(dupes)].join(', ')}`)
  }
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

  // taskId 存在性与 verificationMethod 校验
  for (const m of trace.mappings) {
    if (!taskIds.has(m.taskId)) {
      errors.push(`taskId ${m.taskId}（${m.requirementId}）在 tasks.md 中不存在`)
    }
    if (!['test', 'manual'].includes(m.verificationMethod)) {
      errors.push(`mapping ${m.requirementId} 的 verificationMethod 无效: ${m.verificationMethod}`)
    }
  }
}

// 输出结果
if (errors.length > 0) {
  console.error('[FAIL] Coverage Gate 未达标:')
  errors.forEach(e => console.error(`  - ${e}`))
  process.exit(1)
}

console.log('[OK] Coverage Gate 通过')
console.log(`  FR: ${frIds.length} 个, 全部映射`)
console.log(`  NFR: ${nfrIds.length} 个, 全部映射`)
console.log(`  AC: ${acIds.length} 个, 全部覆盖`)
console.log(`  Tasks: ${taskIds.size} 个, 全部存在`)
console.log(`  specHash: ${actualHash}`)
process.exit(0)
