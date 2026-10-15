#!/usr/bin/env node
// audit-converge.mjs — 审计模式收敛判定（不依赖 tasks.md/traceability.json）
// 用法: node sdd/tools/audit-converge.mjs <specPath> <reviewPath> <evidencePath> <projectPath> <outputDir>
// 退出码: 0=全部通过, 1=存在缺口
// 输出: audit-report.json 写入 outputDir

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { execSync } from 'node:child_process'
import { parseSpec } from './spec-parser.mjs'

function readFile(path) {
  let content = readFileSync(path, 'utf-8')
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1)
  return content
}

function tryReadJson(path) {
  try { return JSON.parse(readFile(path)) } catch { return null }
}

// 检查 fileRef 指向的文件是否存在
function fileRefExists(fileRef, projectPath) {
  if (!fileRef) return false
  // fileRef 格式: src/services/auth.ts:50 或 src/auth.ts
  const parts = fileRef.split(':')
  const filePath = parts[0]
  const fullPath = resolve(projectPath, filePath)
  return existsSync(fullPath)
}

// --- 主逻辑 ---
const specPath = process.argv[2]
const reviewPath = process.argv[3]
const evidencePath = process.argv[4]
const projectPath = process.argv[5]
const outputDir = process.argv[6]

if (!specPath || !reviewPath || !evidencePath || !projectPath || !outputDir) {
  console.error('Usage: audit-converge.mjs <specPath> <reviewPath> <evidencePath> <projectPath> <outputDir>')
  process.exit(1)
}

mkdirSync(resolve(outputDir), { recursive: true })

// 解析 spec.md（统一解析器：与 coverage.mjs / is-converged.mjs 同源）
const specContent = readFile(resolve(specPath))
const parsed = parseSpec(specContent)
const specAllReqs = new Set([...parsed.frIds, ...parsed.nfrIds])
const specACs = new Set([...parsed.acIds, ...parsed.orphanACs.map(o => o.id)])
const acToReq = parsed.acToReq
const specACByReq = new Map()
for (const req of parsed.requirements) {
  specACByReq.set(req.id, new Set(req.acs.map(a => a.id)))
}

// 读取 review.json 和 evidence.json
const review = tryReadJson(resolve(reviewPath))
const evidence = tryReadJson(resolve(evidencePath))

const report = {
  converged: false,
  timestamp: new Date().toISOString(),
  specPath: resolve(specPath),
  projectPath: resolve(projectPath),
  conditions: {},
  requirements: []
}

// === C1: 需求完整性（审计专用，不依赖 tasks.md/traceability.json）===
if (!review) {
  report.conditions.C1 = { passed: false, details: ['review.json 不存在'] }
} else {
  const reviewIds = new Set((review.requirements || []).map(r => r.id))
  const missingInReview = [...specAllReqs].filter(id => !reviewIds.has(id))
  const extraInReview = [...reviewIds].filter(id => !specAllReqs.has(id))
  const details = []
  if (missingInReview.length > 0) details.push(`review.json 缺少需求: ${missingInReview.join(', ')}`)
  if (extraInReview.length > 0) details.push(`review.json 多余需求: ${extraInReview.join(', ')}`)
  report.conditions.C1 = { passed: details.length === 0, details: details.length > 0 ? details : undefined }
}

// === C2: AC 覆盖完整性（含归属校验，EARS-P1）===
if (!review) {
  report.conditions.C2 = { passed: false, details: ['review.json 不存在'] }
} else {
  const coveredACs = new Set()
  const details = []
  for (const r of (review.requirements || [])) {
    const expectedACs = specACByReq.get(r.id) || new Set()
    for (const ac of (r.evidenceRefs || [])) {
      if (!specACs.has(ac)) {
        details.push(`${r.id}: evidenceRef "${ac}" 在 spec.md 中不存在`)
      } else if (!expectedACs.has(ac)) {
        details.push(`${r.id}: evidenceRef "${ac}" 不属于该需求（属于 ${acToReq[ac] || '未知'}）`)
      }
      coveredACs.add(ac)
    }
  }
  const uncovered = [...specACs].filter(ac => !coveredACs.has(ac))
  if (uncovered.length > 0) details.push(`以下 AC 未在 review.json evidenceRefs 中出现: ${uncovered.join(', ')}`)
  report.conditions.C2 = {
    passed: details.length === 0,
    details: details.length > 0 ? details : undefined
  }
}

// === C3: 所有需求审查状态为 pass ===
if (!review) {
  report.conditions.C3 = { passed: false, details: ['review.json 不存在'] }
} else {
  const nonPass = (review.requirements || []).filter(r => r.status !== 'pass')
  report.conditions.C3 = {
    passed: nonPass.length === 0,
    details: nonPass.length > 0 ? nonPass.map(r => `${r.id}: ${r.status}${r.finding ? ' - ' + r.finding.slice(0, 100) : ''}`) : undefined
  }
}

// === C4: 逐 AC 证据绑定（增强版——P0-C 修复）===
if (!review) {
  report.conditions.C4 = { passed: false, details: ['review.json 不存在'] }
} else if (!evidence) {
  report.conditions.C4 = { passed: false, details: ['evidence.json 不存在'] }
} else {
  const noEvidence = []
  const testResults = evidence.testResults || []
  const passedTestNames = new Set(testResults.filter(t => t.status === 'passed').map(t => t.name))

  // evidence 整体状态检查
  if (evidence.status !== 'passed') {
    noEvidence.push('evidence.json status 非 passed')
  }
  if (evidence.tests && evidence.tests.total === 0) {
    noEvidence.push('测试用例数为零')
  }

  for (const r of (review.requirements || [])) {
    const verifications = r.verifications

    // === P0-C 修复点 1: status=pass 必须有非空 verifications 数组 ===
    if (r.status === 'pass') {
      if (!Array.isArray(verifications) || verifications.length === 0) {
        noEvidence.push(`${r.id}: status=pass 但 verifications 为空数组（至少需要一条有效验证证据）`)
        continue
      }
    }

    // === P0-C 修复点 2: 任何 verification result=failed 时，所属 requirement 不能是 pass ===
    if (r.status === 'pass' && Array.isArray(verifications)) {
      const failedVerifs = verifications.filter(v => v.result === 'failed')
      if (failedVerifs.length > 0) {
        noEvidence.push(`${r.id}: status=pass 但存在 ${failedVerifs.length} 条 result=failed 的验证（不能支撑 pass 判定）`)
      }
    }

    // === EARS-P1：逐 AC 验证（以 spec 解析出的 AC 全集为准，NFR 无免检路径）===
    const expectedACs = specACByReq.get(r.id) || new Set()
    for (const acId of expectedACs) {
      const verif = (verifications || []).find(v => v.ac === acId)
      if (!verif) {
        noEvidence.push(`${r.id}: AC ${acId} 缺少 verification 条目（EARS 契约要求逐 AC）`)
        continue
      }
      // === P0-C 修复点 3: 支撑 pass 的 verification 必须 result=passed ===
      if (r.status === 'pass' && verif.result !== 'passed') {
        noEvidence.push(`${acId}: verification result=${verif.result || 'undefined'}（pass 需要所有验证 result=passed）`)
      }
      if (verif.type === 'automated_test') {
        if (!verif.testId) {
          noEvidence.push(`${acId}: automated_test 但无 testId`)
        } else if (!passedTestNames.has(verif.testId)) {
          noEvidence.push(`${acId}: testId "${verif.testId}" 不在 evidence.json 已通过测试中`)
        }
      } else if (verif.type === 'static_check') {
        if (!verif.reason || verif.reason.trim().length === 0) {
          noEvidence.push(`${acId}: static_check 但无 reason`)
        } else if (!verif.fileRef) {
          noEvidence.push(`${acId}: static_check 但无 fileRef`)
        } else if (!fileRefExists(verif.fileRef, projectPath)) {
          noEvidence.push(`${acId}: fileRef "${verif.fileRef}" 指向的文件不存在`)
        }
      } else if (verif.type === 'manual') {
        if (!verif.reason || verif.reason.trim().length === 0) {
          noEvidence.push(`${acId}: manual 但无 reason`)
        } else if (!verif.approver) {
          noEvidence.push(`${acId}: manual 但无 approver`)
        }
      } else {
        noEvidence.push(`${acId}: verification type "${verif.type}" 无效（automated_test|static_check|manual）`)
      }
    }

    // === EARS-P1：禁止 ac=null（旧版 NFR 免检路径已废除）===
    for (const verif of (verifications || [])) {
      if (verif.ac === null || verif.ac === undefined) {
        noEvidence.push(`${r.id}: 存在 ac=null 的 verification（EARS 契约禁止，NFR 必须逐 AC）`)
      } else if (!expectedACs.has(verif.ac)) {
        noEvidence.push(`${r.id}: verification 引用的 AC ${verif.ac} 不属于该需求`)
      }
    }
  }

  report.conditions.C4 = {
    passed: noEvidence.length === 0,
    details: noEvidence.length > 0 ? noEvidence : undefined
  }
}

// === C5: 构建与测试通过 ===
if (!evidence) {
  report.conditions.C5 = { passed: false, details: ['evidence.json 不存在'] }
} else {
  const details = []
  if (evidence.status !== 'passed') details.push(`evidence status=${evidence.status}`)
  if (evidence.tests && evidence.tests.total === 0) details.push('测试用例数为零')
  if (evidence.build && !evidence.build.passed) details.push('构建失败')
  if (evidence.tests && evidence.tests.failed > 0) details.push(`${evidence.tests.failed} 个测试失败`)
  report.conditions.C5 = { passed: details.length === 0, details: details.length > 0 ? details : undefined }
}

// === C7: 不存在阻断级问题 ===
if (!review) {
  report.conditions.C7 = { passed: false, details: ['review.json 不存在'] }
} else {
  const blockingStatuses = ['missing', 'contradicts', 'unverified']
  const blocking = (review.requirements || []).filter(r => blockingStatuses.includes(r.status))
  const blockingDetails = blocking.map(r => `${r.id}: ${r.status}${r.finding ? ' - ' + r.finding.slice(0, 100) : ''}`)
  if (evidence && evidence.build && !evidence.build.passed) blockingDetails.push('构建失败')
  if (evidence && evidence.tests && evidence.tests.total === 0) blockingDetails.push('无测试执行')
  report.conditions.C7 = {
    passed: blockingDetails.length === 0,
    details: blockingDetails.length > 0 ? blockingDetails : undefined
  }
}

// === 汇总审计报告 ===
const allConditions = ['C1', 'C2', 'C3', 'C4', 'C5', 'C7']
const allPassed = allConditions.every(c => report.conditions[c]?.passed === true)
report.converged = allPassed
report.fullyImplemented = allPassed

// 逐需求汇总
if (review) {
  for (const r of (review.requirements || [])) {
    report.requirements.push({
      id: r.id,
      status: r.status,
      finding: r.finding || null,
      evidenceRefs: r.evidenceRefs || [],
      verifications: r.verifications || []
    })
  }
}

// 统计
const statusCounts = {}
for (const r of report.requirements) {
  statusCounts[r.status] = (statusCounts[r.status] || 0) + 1
}
report.summary = {
  totalRequirements: report.requirements.length,
  statusCounts,
  fullyImplemented: allPassed
}

// 写入报告
const reportPath = resolve(outputDir, 'audit-report.json')
writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf-8')

console.log(JSON.stringify(report, null, 2))
process.exit(allPassed ? 0 : 1)
