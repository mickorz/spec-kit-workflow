#!/usr/bin/env node
// freeze-review.mjs — 计算 spec.md sha256 填入 review.json
// 用法: node sdd/tools/freeze-review.mjs <feature>
// Agent 无法计算 sha256，由工具填充
// 退出码: 0=成功, 1=失败

import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'

function readFile(path) {
  let content = readFileSync(path, 'utf-8')
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1)
  return content
}

const feature = process.argv[2]
if (!feature) {
  console.error('Usage: node freeze-review.mjs <feature>')
  process.exit(1)
}

const dir = resolve('specs', feature)
const specFile = resolve(dir, 'spec.md')
const reviewFile = resolve(dir, 'review.json')

if (!existsSync(specFile)) {
  console.error('[FAIL] spec.md 不存在')
  process.exit(1)
}
if (!existsSync(reviewFile)) {
  console.error('[FAIL] review.json 不存在')
  process.exit(1)
}

const specHash = 'sha256-' + createHash('sha256').update(readFile(specFile)).digest('hex')

let review
try {
  review = JSON.parse(readFile(reviewFile))
} catch (e) {
  console.error(`[FAIL] review.json 解析失败: ${e.message}`)
  process.exit(1)
}

review.specHash = specHash

writeFileSync(reviewFile, JSON.stringify(review, null, 2) + '\n', 'utf-8')
console.log(`[OK] review.json specHash 已填充: ${specHash}`)
process.exit(0)
