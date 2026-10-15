#!/usr/bin/env node
// audit-spec-parse.mjs — 从 spec.md 提取全部 FR/AC/NFR 及映射关系
// 用法: node sdd/tools/audit-spec-parse.mjs <specPath>
// 输出: JSON 到 stdout，包含 requirements 数组和 acToReq 映射
// EARS-P0 改造：内部改用统一解析器 spec-parser.mjs（与 coverage.mjs / validate-ears.mjs 同源），
// stdout JSON 结构保持不变，sdd-audit.js 等现有消费者零改动。

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseSpec, allACIds } from './spec-parser.mjs'

const specPath = process.argv[2]
if (!specPath || !existsSync(resolve(specPath))) {
  console.error('Usage: node audit-spec-parse.mjs <specPath>')
  process.exit(1)
}

const specContent = readFileSync(resolve(specPath), 'utf-8')
const parsed = parseSpec(specContent)

// 保持与旧版一致的输出结构
const result = {
  specPath: resolve(specPath),
  totalRequirements: parsed.requirements.length,
  totalFR: parsed.frIds.length,
  totalNFR: parsed.nfrIds.length,
  totalAC: allACIds(parsed).length,
  frIds: parsed.frIds,
  nfrIds: parsed.nfrIds,
  acIds: allACIds(parsed),
  acToReq: parsed.acToReq,
  requirements: parsed.requirements.map(r => ({
    id: r.id,
    acceptanceCriteria: r.acs.map(a => a.id)
  }))
}

console.log(JSON.stringify(result, null, 2))
