#!/usr/bin/env node
// validate-review.mjs — 独立校验 review.json 结构/ID/specHash/证据引用
// 用法: node sdd/tools/validate-review.mjs <feature> <round>
// 退出码: 0=合规, 1=不合规
// 这是确定性工具：不判断 LLM 的语义结论是否真实，只校验结构完整性

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'

function readFile(path) {
  let content = readFileSync(path, 'utf-8')
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1)
  return content
}

function tryReadJson(path) {
  try {
    return JSON.parse(readFile(path))
  } catch {
    return null
  }
}

const feature = process.argv[2]
const round = parseInt(process.argv[3] || '1', 10)

if (!feature) {
  console.error('Usage: node validate-review.mjs <feature> [round]')
  process.exit(1)
}

const dir = resolve('specs', feature)
const reviewFile = resolve(dir, 'review.json')
const specFile = resolve(dir, 'spec.md')

const errors = []

// 1. 文件存在性
if (!existsSync(reviewFile)) {
  errors.push('review.json 不存在')
  console.error(JSON.stringify({ valid: false, errors }, null, 2))
  process.exit(1)
}
if (!existsSync(specFile)) {
  errors.push('spec.md 不存在')
  console.error(JSON.stringify({ valid: false, errors }, null, 2))
  process.exit(1)
}

const review = tryReadJson(reviewFile)
const specContent = readFile(specFile)

// 2. JSON 解析
if (!review) {
  errors.push('review.json 解析失败')
  console.error(JSON.stringify({ valid: false, errors }, null, 2))
  process.exit(1)
}

// 3. 字段校验
if (review.feature !== feature) {
  errors.push(`feature 不匹配: review=${review.feature}, expected=${feature}`)
}
if (review.round !== round) {
  errors.push(`round 不匹配: review=${review.round}, expected=${round}`)
}
if (!review.reviewerLabel || typeof review.reviewerLabel !== 'string') {
  errors.push('reviewerLabel 缺失或非字符串')
}
if (!Array.isArray(review.requirements) || review.requirements.length === 0) {
  errors.push('requirements 缺失或为空数组')
  console.error(JSON.stringify({ valid: false, errors }, null, 2))
  process.exit(1)
}

// 4. specHash 校验
const expectedSpecHash = 'sha256-' + createHash('sha256').update(specContent).digest('hex')
if (review.specHash !== expectedSpecHash) {
  errors.push(`specHash 不匹配: review=${review.specHash}, expected=${expectedSpecHash}`)
}

// 5. ID 集合校验
const specFRs = new Set([...specContent.matchAll(/### (FR-\d+)/g)].map(m => m[1]))
const specNFRs = new Set([...specContent.matchAll(/### (NFR-\d+)/g)].map(m => m[1]))
const specACs = new Set([...specContent.matchAll(/(AC-\d+)/g)].map(m => m[1]))
const specAllReqs = new Set([...specFRs, ...specNFRs])

const reviewIds = new Set(review.requirements.map(r => r.id))
const missingReqs = [...specAllReqs].filter(id => !reviewIds.has(id))
const extraReqs = [...reviewIds].filter(id => !specAllReqs.has(id))
if (missingReqs.length > 0) {
  errors.push(`review.json 缺少需求: ${missingReqs.join(', ')}`)
}
if (extraReqs.length > 0) {
  errors.push(`review.json 多余需求: ${extraReqs.join(', ')}`)
}

// 6. 每条 requirement 字段校验
const validStatuses = ['pass', 'partial', 'missing', 'contradicts', 'unverified']
const coveredACs = new Set()

for (const req of review.requirements) {
  const prefix = `${req.id}: `

  // ID 格式
  if (!/^(FR|NFR)-\d+$/.test(req.id)) {
    errors.push(`${prefix}ID 格式不合规`)
  }

  // status 枚举
  if (!validStatuses.includes(req.status)) {
    errors.push(`${prefix}status "${req.status}" 不在枚举 ${validStatuses.join('|')} 中`)
  }

  // 非 pass 时 finding 必须非空
  if (req.status !== 'pass') {
    if (!req.finding || req.finding.trim().length === 0) {
      errors.push(`${prefix}status=${req.status} 但 finding 为空`)
    }
  }

  // pass 时 finding 应为 null
  if (req.status === 'pass' && req.finding !== null && req.finding !== undefined) {
    errors.push(`${prefix}status=pass 但 finding 非空`)
  }

  // evidenceRefs 校验
  if (!Array.isArray(req.evidenceRefs)) {
    errors.push(`${prefix}evidenceRefs 非数组`)
  } else {
    for (const ac of req.evidenceRefs) {
      if (!specACs.has(ac)) {
        errors.push(`${prefix}evidenceRef "${ac}" 在 spec.md 中不存在`)
      }
      coveredACs.add(ac)
    }
  }
}

// 7. AC 覆盖率校验
const uncoveredACs = [...specACs].filter(ac => !coveredACs.has(ac))
if (uncoveredACs.length > 0) {
  errors.push(`以下 AC 未被任何 requirement 的 evidenceRefs 覆盖: ${uncoveredACs.join(', ')}`)
}

// 8. 重复 ID 检查
const idCounts = {}
for (const req of review.requirements) {
  idCounts[req.id] = (idCounts[req.id] || 0) + 1
}
const duplicates = Object.entries(idCounts).filter(([_, c]) => c > 1)
if (duplicates.length > 0) {
  errors.push(`重复 ID: ${duplicates.map(([id, c]) => `${id}(${c}次)`).join(', ')}`)
}

// 输出结果
const result = {
  valid: errors.length === 0,
  errors,
  stats: {
    requirements: review.requirements.length,
    expectedReqs: specAllReqs.size,
    acceptanceCriteria: specACs.size,
    coveredACs: coveredACs.size,
    uncoveredACs: uncoveredACs.length
  }
}

console.log(JSON.stringify(result, null, 2))
process.exit(errors.length === 0 ? 0 : 1)
