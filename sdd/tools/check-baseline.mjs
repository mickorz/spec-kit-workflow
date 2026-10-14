#!/usr/bin/env node
// check-baseline.mjs — 比对当前文件与审批基线
// 用法: node sdd/tools/check-baseline.mjs <feature>
// 在每轮 Implement/Test/Converge 前执行
// 如果 spec.md、traceability.json 或 tasks.md 被修改，基线不匹配则失败
// 退出码: 0=通过, 1=失败

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'

function readFile(path) {
  let content = readFileSync(path, 'utf-8')
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1)
  return content
}

function fileHash(filePath) {
  return 'sha256-' + createHash('sha256').update(readFile(filePath)).digest('hex')
}

const feature = process.argv[2]
if (!feature) {
  console.error('Usage: node check-baseline.mjs <feature>')
  process.exit(1)
}

const dir = resolve('specs', feature)
const baselineFile = resolve(dir, 'approved-baseline.json')

if (!existsSync(baselineFile)) {
  console.error('[FAIL] 审批基线不存在（请先通过 checkpoint 并运行 freeze-baseline.mjs）')
  process.exit(1)
}

let baseline
try {
  baseline = JSON.parse(readFile(baselineFile))
} catch (e) {
  console.error(`[FAIL] approved-baseline.json 解析失败: ${e.message}`)
  process.exit(1)
}

const errors = []

// 比对 spec.md
const specFile = resolve(dir, 'spec.md')
if (existsSync(specFile)) {
  const currentSpecHash = fileHash(specFile)
  if (currentSpecHash !== baseline.approvedSpecHash) {
    errors.push(`spec.md 已变更（审批后被修改）`)
    errors.push(`  基线: ${baseline.approvedSpecHash}`)
    errors.push(`  当前: ${currentSpecHash}`)
  }
} else {
  errors.push('spec.md 不存在')
}

// 比对 traceability.json
const traceFile = resolve(dir, 'traceability.json')
if (existsSync(traceFile)) {
  const currentTraceHash = fileHash(traceFile)
  if (currentTraceHash !== baseline.approvedTraceabilityHash) {
    errors.push(`traceability.json 已变更（审批后被修改）`)
    errors.push(`  基线: ${baseline.approvedTraceabilityHash}`)
    errors.push(`  当前: ${currentTraceHash}`)
  }
} else {
  errors.push('traceability.json 不存在')
}

// 不检查 tasks.md：循环中 tasks.md 会正常变化（任务标记 done、追加修复任务）
// 只检查 spec.md 和 traceability.json：这两者是审批后不可变的真相源

if (errors.length > 0) {
  console.error('[FAIL] 审批基线校验失败:')
  errors.forEach(e => console.error(`  ${e}`))
  process.exit(1)
}

console.log('[OK] 审批基线校验通过')
console.log(`  spec: ${baseline.approvedSpecHash}`)
console.log(`  traceability: ${baseline.approvedTraceabilityHash}`)
process.exit(0)
