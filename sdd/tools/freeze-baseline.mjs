#!/usr/bin/env node
// freeze-baseline.mjs — 审批通过后冻结批准基线
// 用法: node sdd/tools/freeze-baseline.mjs <feature>
// 在 checkpoint 人工审批通过后执行，保存 spec.md、traceability.json、tasks.md 的哈希
// 后续每轮 Implement/Test/Converge 前用 check-baseline.mjs 比对
// 退出码: 0=成功, 1=失败

import { readFileSync, existsSync, writeFileSync } from 'node:fs'
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
  console.error('Usage: node freeze-baseline.mjs <feature>')
  process.exit(1)
}

const dir = resolve('specs', feature)
const specFile = resolve(dir, 'spec.md')
const traceFile = resolve(dir, 'traceability.json')
const tasksFile = resolve(dir, 'tasks.md')
const baselineFile = resolve(dir, 'approved-baseline.json')

// 检查文件存在
for (const [name, file] of [['spec.md', specFile], ['traceability.json', traceFile], ['tasks.md', tasksFile]]) {
  if (!existsSync(file)) {
    console.error(`[FAIL] ${name} 不存在: ${file}`)
    process.exit(1)
  }
}

const baseline = {
  feature,
  approvedSpecHash: fileHash(specFile),
  approvedTraceabilityHash: fileHash(traceFile),
  approvedTasksHash: fileHash(tasksFile),
  status: 'approved',
  frozenAt: new Date().toISOString()
}

writeFileSync(baselineFile, JSON.stringify(baseline, null, 2) + '\n', 'utf-8')
console.log('[OK] 审批基线已冻结')
console.log(`  spec: ${baseline.approvedSpecHash}`)
console.log(`  traceability: ${baseline.approvedTraceabilityHash}`)
console.log(`  tasks: ${baseline.approvedTasksHash}`)
process.exit(0)
