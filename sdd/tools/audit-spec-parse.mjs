#!/usr/bin/env node
// audit-spec-parse.mjs — 从 spec.md 提取全部 FR/AC/NFR 及映射关系
// 用法: node sdd/tools/audit-spec-parse.mjs <specPath>
// 输出: JSON 到 stdout，包含 requirements 数组和 acToReq 映射

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

function readFile(path) {
  let content = readFileSync(path, 'utf-8')
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1)
  return content
}

const specPath = process.argv[2]
if (!specPath || !existsSync(specPath)) {
  console.error('Usage: node audit-spec-parse.mjs <specPath>')
  process.exit(1)
}

const specContent = readFile(resolve(specPath))

// 提取 FR 和 NFR
const frMatches = [...specContent.matchAll(/### (FR-\d+)/g)]
const nfrMatches = [...specContent.matchAll(/### (NFR-\d+)/g)]
const frIds = frMatches.map(m => m[1])
const nfrIds = nfrMatches.map(m => m[1])
const allReqIds = [...frIds, ...nfrIds]

// 提取 AC 及其所属 FR/NFR
const acToReq = new Map()
let currentReq = null
const acList = []
const lines = specContent.split('\n')
for (const line of lines) {
  const frMatch = line.match(/### (FR-\d+)/)
  const nfrMatch = line.match(/### (NFR-\d+)/)
  if (frMatch) currentReq = frMatch[1]
  if (nfrMatch) currentReq = nfrMatch[1]
  const acMatch = line.match(/(AC-\d+)/)
  if (acMatch && currentReq) {
    acToReq.set(acMatch[1], currentReq)
    if (!acList.includes(acMatch[1])) acList.push(acMatch[1])
  }
}

// 为每个 FR/NFR 构建 AC 列表
const requirements = allReqIds.map(id => {
  const acs = [...acToReq.entries()].filter(([_, req]) => req === id).map(([ac]) => ac)
  return { id, acceptanceCriteria: acs }
})

const result = {
  specPath: resolve(specPath),
  totalRequirements: allReqIds.length,
  totalFR: frIds.length,
  totalNFR: nfrIds.length,
  totalAC: acList.length,
  frIds,
  nfrIds,
  acIds: acList,
  acToReq: Object.fromEntries(acToReq),
  requirements
}

console.log(JSON.stringify(result, null, 2))
