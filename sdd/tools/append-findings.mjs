#!/usr/bin/env node
// append-findings.mjs — 从 evidence.json + review.json 派生缺口，追加修复任务
// 用法: node sdd/tools/append-findings.mjs <feature> <round>
// 退出码: 0=成功, 1=失败
// 三类 finding：
//   test_infrastructure: 测试工具/解析器问题（来自 evidence.json failures）
//   test_failure: 实际测试失败（来自 evidence.json failures）
//   requirement_gap: 需求遗漏/不完整（来自 review.json 非 pass 条目）

import { readFileSync, existsSync, writeFileSync, appendFileSync } from 'node:fs'
import { resolve } from 'node:path'

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
  console.error('Usage: node append-findings.mjs <feature> [round]')
  process.exit(1)
}

const dir = resolve('specs', feature)
const evidenceFile = resolve(dir, 'evidence.json')
const reviewFile = resolve(dir, 'review.json')
const tasksFile = resolve(dir, 'tasks.md')
const findingsFile = resolve(dir, 'findings.json')

// 读取 tasks.md 找到最大 T-NNN
const tasksContent = readFile(tasksFile)
const taskIds = [...tasksContent.matchAll(/## (T-\d+)/g)].map(m => m[1])
let maxNum = 0
for (const id of taskIds) {
  const num = parseInt(id.replace('T-', ''), 10)
  if (num > maxNum) maxNum = num
}

let nextNum = maxNum + 1
const findings = {
  feature,
  round,
  items: []
}
const newTasks = []

// === 来源 1: evidence.json 失败项 ===
const evidence = tryReadJson(evidenceFile)
if (evidence && evidence.failures && evidence.failures.length > 0) {
  for (const f of evidence.failures) {
    const taskId = `T-${String(nextNum).padStart(3, '0')}`
    const test = f.test || 'unknown'
    const reason = f.reason || '未提供原因'

    // 区分 test_infrastructure vs test_failure
    const type = (test === 'none' || test === 'build')
      ? 'test_infrastructure'
      : 'test_failure'

    findings.items.push({
      findingId: `F-${String(findings.items.length + 1).padStart(3, '0')}`,
      taskId,
      type,
      source: 'evidence.json',
      test,
      reason,
      action: 'fix'
    })

    const typeLabel = type === 'test_infrastructure' ? '测试基础设施' : '测试失败'
    newTasks.push(`## ${taskId}: 修复 ${typeLabel} - ${test}
- **来源**: evidence.json round ${round}
- **类型**: ${typeLabel}
- **原因**: ${reason}
- **Status**: pending`)
    nextNum++
  }
}

// === 来源 2: review.json 非 pass 条目 ===
const review = tryReadJson(reviewFile)
if (review && review.requirements) {
  for (const req of review.requirements) {
    if (req.status === 'pass') continue

    const taskId = `T-${String(nextNum).padStart(3, '0')}`
    const reqId = req.id
    const status = req.status
    const finding = req.finding || '未提供详细信息'
    const evidenceRefs = (req.evidenceRefs || []).join(', ') || '无'

    // 需求缺口类型
    const type = 'requirement_gap'
    const action = status === 'missing' ? 'create' : 'fix'

    findings.items.push({
      findingId: `F-${String(findings.items.length + 1).padStart(3, '0')}`,
      taskId,
      type,
      source: 'review.json',
      requirementId: reqId,
      status,
      reason: finding,
      evidenceRefs: req.evidenceRefs || [],
      action
    })

    const statusLabel = {
      missing: '完全未实现',
      partial: '部分实现',
      contradicts: '与 Spec 矛盾',
      unverified: '证据不足'
    }[status] || status

    newTasks.push(`## ${taskId}: ${action === 'create' ? '实现' : '修复'} ${reqId} - ${statusLabel}
- **来源**: review.json round ${round}
- **类型**: 需求缺口
- **需求**: ${reqId}
- **状态**: ${statusLabel}
- **详情**: ${finding}
- **关联验收**: ${evidenceRefs}
- **Status**: pending`)
    nextNum++
  }
}

// 如果 evidence status=passed 且 review 不存在或全部 pass，仍写空 findings
if (findings.items.length === 0) {
  console.log('[OK] 无缺口需追加')
  findings.derivedFrom = evidence && review ? 'evidence.json + review.json' : (evidence ? 'evidence.json' : 'review.json')
  writeFileSync(findingsFile, JSON.stringify(findings, null, 2) + '\n', 'utf-8')
  process.exit(0)
}

// 写入 findings.json
findings.derivedFrom = evidence && review ? 'evidence.json + review.json' : (evidence ? 'evidence.json' : 'review.json')
writeFileSync(findingsFile, JSON.stringify(findings, null, 2) + '\n', 'utf-8')

// 追加到 tasks.md
if (newTasks.length > 0) {
  const appendContent = `\n\n<!-- 以下为 round ${round} 追加的修复任务 -->\n${newTasks.join('\n\n')}\n`
  appendFileSync(tasksFile, appendContent, 'utf-8')
}

// 输出分类统计
const stats = {}
for (const item of findings.items) {
  stats[item.type] = (stats[item.type] || 0) + 1
}

console.log(`[OK] 追加 ${newTasks.length} 个修复任务`)
for (const [type, count] of Object.entries(stats)) {
  console.log(`  ${type}: ${count} 个`)
}
console.log(`  findings.json: ${findingsFile}`)
console.log(`  新任务: ${findings.items.map(i => i.taskId).join(', ')}`)
process.exit(0)
