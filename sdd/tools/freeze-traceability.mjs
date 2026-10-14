#!/usr/bin/env node
// freeze-traceability.mjs — 计算 spec.md 的 sha256 并写入 traceability.json
// 用法: node sdd/tools/freeze-traceability.mjs <feature>
// 退出码: 0=成功, 1=失败

import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'

const feature = process.argv[2]
if (!feature) {
  console.error('Usage: node freeze-traceability.mjs <feature>')
  process.exit(1)
}

const dir = resolve('specs', feature)
const specFile = resolve(dir, 'spec.md')
const traceFile = resolve(dir, 'traceability.json')

if (!existsSync(specFile)) {
  console.error(`[FAIL] spec.md 不存在: ${specFile}`)
  process.exit(1)
}
if (!existsSync(traceFile)) {
  console.error(`[FAIL] traceability.json 不存在: ${traceFile}`)
  process.exit(1)
}

const specContent = readFileSync(specFile, 'utf-8')
const specHash = 'sha256-' + createHash('sha256').update(specContent).digest('hex')

const trace = JSON.parse(readFileSync(traceFile, 'utf-8'))
trace.specHash = specHash

writeFileSync(traceFile, JSON.stringify(trace, null, 2) + '\n', 'utf-8')
console.log(`[OK] traceability.json specHash 已冻结: ${specHash}`)
process.exit(0)
