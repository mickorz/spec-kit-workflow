#!/usr/bin/env node
// is-converged.mjs — 收敛判定：检查 7 项条件是否全部满足
// 用法: node sdd/tools/is-converged.mjs <feature> <round>
// 退出码: 0=已收敛(全部通过), 1=未收敛
// 输出: stdout 输出 JSON 报告，同时写入 specs/<feature>/converge-report.json

import { readFileSync, existsSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join, relative } from 'node:path'
import { createHash } from 'node:crypto'
import { execSync } from 'node:child_process'
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

function fileHash(filePath) {
  const content = readFileSync(filePath)
  return 'sha256-' + createHash('sha256').update(content).digest('hex')
}

// glob 匹配（与 run-tests.mjs 一致）
function globToRegex(pattern) {
  let result = ''
  let i = 0
  while (i < pattern.length) {
    if (pattern[i] === '*' && pattern[i + 1] === '*') {
      if (pattern[i + 2] === '/') {
        result += '(?:[^/]*/)*'
        i += 3
      } else {
        result += '.*'
        i += 2
      }
    } else if (pattern[i] === '*') {
      result += '[^/]*'
      i++
    } else if (pattern[i] === '.') {
      result += '\\.'
      i++
    } else if (pattern[i] === '?') {
      result += '[^/]'
      i++
    } else {
      result += pattern[i]
      i++
    }
  }
  return new RegExp('^' + result + '$')
}

function globMatch(baseDir, patterns) {
  const results = new Set()
  for (const pattern of patterns) {
    const regex = globToRegex(pattern)
    function walk(dir) {
      if (!existsSync(dir)) return
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        const rel = relative(baseDir, full).replace(/\\/g, '/')
        if (statSync(full).isDirectory()) {
          walk(full)
        } else if (regex.test(rel)) {
          results.add(rel)
        }
      }
    }
    walk(baseDir)
  }
  return [...results].sort()
}

// --- 主逻辑 ---

const feature = process.argv[2]
const round = parseInt(process.argv[3] || '1', 10)

if (!feature) {
  console.error('Usage: node is-converged.mjs <feature> [round]')
  process.exit(1)
}

const dir = resolve('specs', feature)
const report = {
  converged: false,
  feature,
  round,
  conditions: {}
}

// C1: Coverage Gate 通过（FR+NFR+AC+Tasks ID 集合完整）
try {
  const output = execSync(`node sdd/tools/coverage.mjs ${feature}`, {
    cwd: process.cwd(),
    encoding: 'utf-8',
    timeout: 30000,
    windowsHide: true
  })
  const passed = output.includes('[OK] Coverage Gate')
  report.conditions.C1 = { passed }
  if (!passed) {
    report.conditions.C1.details = ['覆盖率检查未通过']
  }
} catch (e) {
  report.conditions.C1 = { passed: false, details: ['coverage.mjs 执行失败: ' + (e.message || '').slice(0, 200)] }
}

// C5: 构建与测试通过
const evidenceFile = resolve(dir, 'evidence.json')
const evidence = tryReadJson(evidenceFile)

if (!evidence) {
  report.conditions.C5 = { passed: false, details: ['evidence.json 不存在'] }
} else {
  const details = []
  if (evidence.status !== 'passed') {
    details.push(`evidence status=${evidence.status}`)
  }
  if (evidence.tests && evidence.tests.total === 0) {
    details.push('测试用例数为零')
  }
  if (evidence.build && !evidence.build.passed) {
    details.push('构建失败')
  }
  if (evidence.tests && evidence.tests.failed > 0) {
    details.push(`${evidence.tests.failed} 个测试失败`)
  }
  report.conditions.C5 = { passed: details.length === 0, details: details.length > 0 ? details : undefined }
}

// C6: 文件哈希与当前代码一致
if (!evidence || !evidence.fileHashes) {
  report.conditions.C6 = { passed: false, details: ['evidence.json 无 fileHashes'] }
} else {
  const config = tryReadJson(resolve('sdd', 'config.json'))
  const featureConfig = config?.features?.[feature]
  const appDir = featureConfig ? resolve(featureConfig.appDir) : null
  const mismatched = []

  for (const entry of evidence.fileHashes) {
    if (!appDir) {
      mismatched.push(`${entry.file} (无法定位 appDir)`)
      continue
    }
    const fullPath = resolve(appDir, entry.file)
    if (!existsSync(fullPath)) {
      mismatched.push(`${entry.file} (文件不存在)`)
      continue
    }
    const currentHash = fileHash(fullPath)
    if (currentHash !== entry.hash) {
      mismatched.push(`${entry.file} (哈希不匹配)`)
    }
  }

  // 还要检查是否有新文件（当前存在但 evidence 未记录）
  if (featureConfig && appDir) {
    const sourceFiles = globMatch(appDir, featureConfig.sourceGlobs || [])
    const testFiles = globMatch(appDir, featureConfig.testGlobs || [])
    const allCurrent = new Set([...sourceFiles, ...testFiles])
    const recorded = new Set(evidence.fileHashes.map(e => e.file))
    for (const f of allCurrent) {
      if (!recorded.has(f)) {
        mismatched.push(`${f} (新文件未在 evidence 中记录)`)
      }
    }
  }

  report.conditions.C6 = { passed: mismatched.length === 0, details: mismatched.length > 0 ? mismatched : undefined }
}

// C2-C4, C7: 依赖 review.json
// review.json 不存在时，这些条件为 pending（非 skipped），converged 必须为 false
const reviewFile = resolve(dir, 'review.json')
const review = tryReadJson(reviewFile)

if (!review) {
  // 无 review.json = Reviewer 未执行，收敛条件不满足
  report.conditions.C2 = { passed: false, status: 'pending', details: ['review.json 不存在，Reviewer 未执行'] }
  report.conditions.C3 = { passed: false, status: 'pending', details: ['review.json 不存在'] }
  report.conditions.C4 = { passed: false, status: 'pending', details: ['review.json 不存在'] }
  report.conditions.C7 = { passed: false, status: 'pending', details: ['review.json 不存在'] }
} else {
  // C2: review.json 包含每条 FR 和 NFR（统一解析器）
  const specFile = resolve(dir, 'spec.md')
  const specContent = readFile(specFile)
  const parsed = parseSpec(specContent)
  const specAllReqs = new Set([...parsed.frIds, ...parsed.nfrIds])
  const specACByReq = new Map()
  for (const req of parsed.requirements) {
    specACByReq.set(req.id, new Set(req.acs.map(a => a.id)))
  }
  const reviewIds = new Set((review.requirements || []).map(r => r.id))
  const missingInReview = [...specAllReqs].filter(id => !reviewIds.has(id))
  const extraInReview = [...reviewIds].filter(id => !specAllReqs.has(id))
  const c2Details = []
  if (missingInReview.length > 0) c2Details.push(`review.json 缺少: ${missingInReview.join(', ')}`)
  if (extraInReview.length > 0) c2Details.push(`review.json 多余: ${extraInReview.join(', ')}`)
  report.conditions.C2 = { passed: c2Details.length === 0, details: c2Details.length > 0 ? c2Details : undefined }

  // C3: 所有 FR 和 NFR 审查状态都是 pass
  const nonPass = (review.requirements || []).filter(r => r.status !== 'pass')
  report.conditions.C3 = {
    passed: nonPass.length === 0,
    details: nonPass.length > 0 ? nonPass.map(r => `${r.id}: ${r.status}${r.finding ? ' - ' + r.finding.slice(0, 80) : ''}`) : undefined
  }

  // C4: 每条 AC 有明确的验证证据（EARS-P1：逐 AC 口径，FR 与 NFR 一致）
  // 检查四层：
  //   a) evidence.json status=passed 且测试数 > 0
  //   b) spec.md 中每条 AC 出现在 review.json 某条 requirement 的 evidenceRefs 中，且归属正确
  //   c) 引用该 AC 的 requirement 状态为 pass
  //   d) 逐 AC verification：每个 AC 必须有条目；automated_test 的 testId 在 evidence.json testResults 中存在且 passed；
  //      static_check 有 reason+fileRef；manual 有 reason+approver；废除 NFR ac=null 免检路径
  const specACs = new Set([...specACByReq.values()].flatMap(s => [...s]))
  const acToReq = parsed.acToReq
  const reviewReqMap = new Map()
  for (const r of (review.requirements || [])) {
    reviewReqMap.set(r.id, r)
  }
  const coveredACs = new Set()
  for (const r of (review.requirements || [])) {
    for (const ac of (r.evidenceRefs || [])) {
      coveredACs.add(ac)
    }
  }
  const noEvidence = []
  // a) evidence 整体状态
  if (!evidence || evidence.status !== 'passed') {
    noEvidence.push('evidence.json status 非 passed')
  } else if (evidence.tests && evidence.tests.total === 0) {
    noEvidence.push('测试用例数为零')
  }
  // b) 每条 AC 被 review.json 引用且归属正确
  for (const ac of specACs) {
    if (!coveredACs.has(ac)) {
      noEvidence.push(`AC ${ac} 未在 review.json evidenceRefs 中出现`)
      continue
    }
    const expectedReq = acToReq[ac]
    for (const r of (review.requirements || [])) {
      if ((r.evidenceRefs || []).includes(ac)) {
        if (r.status !== 'pass') {
          noEvidence.push(`${ac} 关联需求 ${r.id}: ${r.status} 非 pass`)
        }
        if (expectedReq && r.id !== expectedReq) {
          noEvidence.push(`${ac} 应属于 ${expectedReq} 但被 ${r.id} 引用`)
        }
      }
    }
  }
  // d) 逐 AC verification（含 NFR：无免检路径）
  const testResults = (evidence && evidence.testResults) || []
  const testResultNames = new Set(testResults.map(t => t.name))
  const passedTestNames = new Set(testResults.filter(t => t.status === 'passed').map(t => t.name))
  for (const r of (review.requirements || [])) {
    const expectedACs = specACByReq.get(r.id) || new Set()
    const verifications = r.verifications
    if (r.status === 'pass') {
      if (!Array.isArray(verifications)) {
        noEvidence.push(`${r.id}: status=pass 但无 verifications 数组（逐 AC 证据必需）`)
        continue
      }
      // 逐 AC 覆盖：该需求的全部 AC 都必须有 verification 条目且通过
      for (const acId of expectedACs) {
        const verif = verifications.find(v => v.ac === acId)
        if (!verif) {
          noEvidence.push(`${r.id}: AC ${acId} 缺少 verification 条目`)
          continue
        }
        if (verif.type === 'automated_test') {
          if (!verif.testId) {
            noEvidence.push(`${acId}: automated_test 但无 testId`)
          } else if (!testResultNames.has(verif.testId)) {
            noEvidence.push(`${acId}: testId "${verif.testId}" 不在 evidence.json testResults 中`)
          } else if (!passedTestNames.has(verif.testId)) {
            noEvidence.push(`${acId}: testId "${verif.testId}" 在 testResults 中但状态非 passed`)
          }
        } else if (verif.type === 'static_check') {
          if (!verif.reason || verif.reason.trim().length === 0) {
            noEvidence.push(`${acId}: static_check 但无 reason`)
          } else if (!verif.fileRef) {
            noEvidence.push(`${acId}: static_check 但无 fileRef（需指向具体文件或代码位置）`)
          }
        } else if (verif.type === 'manual') {
          if (!verif.reason || verif.reason.trim().length === 0) {
            noEvidence.push(`${acId}: manual 但无 reason`)
          } else if (!verif.approver) {
            noEvidence.push(`${acId}: manual 但无 approver（需审批人标识）`)
          }
        } else {
          noEvidence.push(`${acId}: verification type "${verif.type}" 无效`)
        }
      }
      // 禁止 ac=null（旧版 NFR 免检路径）
      for (const v of verifications) {
        if (v.ac === null || v.ac === undefined) {
          noEvidence.push(`${r.id}: 存在 ac=null 的 verification（EARS 契约禁止，NFR 必须逐 AC）`)
        } else if (!expectedACs.has(v.ac)) {
          noEvidence.push(`${r.id}: verification 引用的 AC ${v.ac} 不属于该需求`)
        }
      }
    }
  }
  report.conditions.C4 = {
    passed: noEvidence.length === 0,
    details: noEvidence.length > 0 ? noEvidence : undefined
  }

  // C7: 不存在阻断级问题
  // 阻断级定义：missing（完全未实现）、contradicts（与 Spec 矛盾）、unverified（无证据）
  // 另外构建失败和零测试也视为阻断级（来自 evidence.json）
  const blockingStatuses = ['missing', 'contradicts', 'unverified']
  const blocking = (review.requirements || []).filter(r => blockingStatuses.includes(r.status))
  const blockingDetails = blocking.map(r => `${r.id}: ${r.status}`)
  // 构建失败 = 阻断
  if (evidence && evidence.build && !evidence.build.passed) {
    blockingDetails.push('构建失败（blocker）')
  }
  // 零测试 = 阻断
  if (evidence && evidence.tests && evidence.tests.total === 0 && evidence.status !== 'passed') {
    blockingDetails.push('无测试执行（blocker）')
  }
  report.conditions.C7 = {
    passed: blockingDetails.length === 0,
    details: blockingDetails.length > 0 ? blockingDetails : undefined
  }
}

// 汇总判定
const engineeringConditions = ['C1', 'C5', 'C6']
const allConditions = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7']

const engineeringPassed = engineeringConditions.every(c => report.conditions[c]?.passed === true)
const allPassed = allConditions.every(c => report.conditions[c]?.passed === true)

report.engineeringPassed = engineeringPassed
report.converged = allPassed
report.status = allPassed ? 'converged' : (engineeringPassed ? 'pending_review' : 'not_converged')

// 写入报告文件
const reportFile = resolve(dir, 'converge-report.json')
writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n', 'utf-8')

// 输出到 stdout
console.log(JSON.stringify(report, null, 2))
process.exit(allPassed ? 0 : 1)
