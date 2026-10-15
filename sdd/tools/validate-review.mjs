#!/usr/bin/env node
// validate-review.mjs — 独立校验 review.json 结构/ID/specHash/证据引用
// 用法: node sdd/tools/validate-review.mjs <feature> <round>
// 退出码: 0=合规, 1=不合规
// 这是确定性工具：不判断 LLM 的语义结论是否真实，只校验结构完整性
// EARS-P1 改造：统一解析器；verifications 必须逐 AC 覆盖（FR 与 NFR 一致）；废除 NFR ac=null 免检路径

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { parseSpec } from './spec-parser.mjs'

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

// 5. ID 集合校验（统一解析器：与 coverage.mjs / is-converged.mjs 同源）
const parsed = parseSpec(specContent)
const specAllReqs = new Set([...parsed.frIds, ...parsed.nfrIds])
const specACByReq = new Map()
for (const req of parsed.requirements) {
  specACByReq.set(req.id, new Set(req.acs.map(a => a.id)))
}

const reviewIds = new Set(review.requirements.map(r => r.id))
const missingReqs = [...specAllReqs].filter(id => !reviewIds.has(id))
const extraReqs = [...reviewIds].filter(id => !specAllReqs.has(id))
if (missingReqs.length > 0) {
  errors.push(`review.json 缺少需求: ${missingReqs.join(', ')}`)
}
if (extraReqs.length > 0) {
  errors.push(`review.json 多余需求: ${extraReqs.join(', ')}`)
}

// 6. 每条 requirement 字段校验 + 逐 AC 证据覆盖（EARS-P1）
const validStatuses = ['pass', 'partial', 'missing', 'contradicts', 'unverified']
const coveredACs = new Set()

for (const req of review.requirements) {
  const prefix = `${req.id}: `

  // ID 格式
  if (!/^(FR|NFR)-\d{3}$/.test(req.id)) {
    errors.push(`${prefix}ID 格式不合规（三位数字）`)
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

  // evidenceRefs 校验（引用的 AC 必须属于该需求）
  const expectedACs = specACByReq.get(req.id) || new Set()
  if (!Array.isArray(req.evidenceRefs)) {
    errors.push(`${prefix}evidenceRefs 非数组`)
  } else {
    for (const ac of req.evidenceRefs) {
      if (!expectedACs.has(ac)) {
        if (specACByReq.get(parsed.acToReq[ac])?.has(ac)) {
          errors.push(`${prefix}evidenceRef "${ac}" 不属于该需求（属于 ${parsed.acToReq[ac]}）`)
        } else {
          errors.push(`${prefix}evidenceRef "${ac}" 在 spec.md 中不存在`)
        }
      }
      coveredACs.add(ac)
    }
  }

  // 逐 AC verification 覆盖（EARS-P1：FR 与 NFR 一致，废除 ac=null 免检路径）
  const verifications = req.verifications
  if (req.status === 'pass') {
    if (!Array.isArray(verifications) || verifications.length === 0) {
      errors.push(`${prefix}status=pass 但无 verifications 数组（逐 AC 证据必需）`)
    } else {
      // 每个 AC 必须有 verification 条目
      for (const acId of expectedACs) {
        const verif = verifications.find(v => v.ac === acId)
        if (!verif) {
          errors.push(`${prefix}AC ${acId} 缺少 verification 条目`)
          continue
        }
        // 类型与必填字段
        if (verif.type === 'automated_test') {
          if (!verif.testId) errors.push(`${prefix}${acId}: automated_test 但无 testId`)
        } else if (verif.type === 'static_check') {
          if (!verif.reason || String(verif.reason).trim().length === 0) {
            errors.push(`${prefix}${acId}: static_check 但无 reason`)
          }
          if (!verif.fileRef) {
            errors.push(`${prefix}${acId}: static_check 但无 fileRef`)
          }
        } else if (verif.type === 'manual') {
          if (!verif.reason || String(verif.reason).trim().length === 0) {
            errors.push(`${prefix}${acId}: manual 但无 reason`)
          }
          if (!verif.approver) {
            errors.push(`${prefix}${acId}: manual 但无 approver`)
          }
        } else {
          errors.push(`${prefix}${acId}: verification type "${verif.type}" 无效（automated_test|static_check|manual）`)
        }
        if (verif.result !== 'passed') {
          errors.push(`${prefix}${acId}: verification result 非 passed`)
        }
      }
      // 禁止 ac=null（旧版 NFR 免检路径）
      for (const v of verifications) {
        if (v.ac === null || v.ac === undefined) {
          errors.push(`${prefix}存在 ac=null 的 verification（EARS 契约禁止，NFR 必须逐 AC）`)
        } else if (!expectedACs.has(v.ac)) {
          errors.push(`${prefix}verification 引用的 AC ${v.ac} 不属于该需求`)
        }
      }
    }
  }
}

// 7. AC 总覆盖校验（全 Spec 口径）
const allSpecACs = new Set([...specACByReq.values()].flatMap(s => [...s]))
const uncoveredACs = [...allSpecACs].filter(ac => !coveredACs.has(ac))
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
    acceptanceCriteria: allSpecACs.size,
    coveredACs: coveredACs.size,
    uncoveredACs: uncoveredACs.length
  }
}

console.log(JSON.stringify(result, null, 2))
process.exit(errors.length === 0 ? 0 : 1)
