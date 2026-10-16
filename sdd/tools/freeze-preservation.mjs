#!/usr/bin/env node
// freeze-preservation.mjs — 计算来源链三哈希并写入 preservation-review.json
// 用法: node sdd/tools/freeze-preservation.mjs <feature>
// 退出码: 0=成功, 1=失败
// 三个哈希锚定被审文件的当前版本：prdHash(source-prd.md) / specHash(spec.md) / sourceMapHash(source-map.json)

import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'

const feature = process.argv[2]
if (!feature) {
  console.error('Usage: node sdd/tools/freeze-preservation.mjs <feature>')
  process.exit(1)
}

const dir = resolve('specs', feature)
const reviewFile = resolve(dir, 'preservation-review.json')
const files = {
  prdHash: resolve(dir, 'source-prd.md'),
  specHash: resolve(dir, 'spec.md'),
  sourceMapHash: resolve(dir, 'source-map.json')
}

for (const [name, file] of Object.entries(files)) {
  if (!existsSync(file)) {
    console.error(`[FAIL] ${name} 对应文件不存在: ${file}`)
    process.exit(1)
  }
}
if (!existsSync(reviewFile)) {
  console.error(`[FAIL] preservation-review.json 不存在: ${reviewFile}`)
  process.exit(1)
}

const review = JSON.parse(readFileSync(reviewFile, 'utf-8'))
for (const [name, file] of Object.entries(files)) {
  const content = readFileSync(file, 'utf-8')
  review[name] = 'sha256-' + createHash('sha256').update(content).digest('hex')
}

writeFileSync(reviewFile, JSON.stringify(review, null, 2) + '\n', 'utf-8')
console.log(`[OK] preservation-review.json 三哈希已冻结: prd=${review.prdHash.slice(0, 20)}... spec=${review.specHash.slice(0, 20)}... sourceMap=${review.sourceMapHash.slice(0, 20)}...`)
process.exit(0)
