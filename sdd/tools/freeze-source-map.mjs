#!/usr/bin/env node
// freeze-source-map.mjs — 计算 source-prd.md 的 sha256 并写入 source-map.json 的 prdHash
// 用法: node sdd/tools/freeze-source-map.mjs <feature>
// 退出码: 0=成功, 1=失败

import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'

const feature = process.argv[2]
if (!feature) {
  console.error('Usage: node freeze-source-map.mjs <feature>')
  process.exit(1)
}

const dir = resolve('specs', feature)
const prdFile = resolve(dir, 'source-prd.md')
const mapFile = resolve(dir, 'source-map.json')

if (!existsSync(prdFile)) {
  console.error(`[FAIL] source-prd.md 不存在: ${prdFile}`)
  process.exit(1)
}
if (!existsSync(mapFile)) {
  console.error(`[FAIL] source-map.json 不存在: ${mapFile}`)
  process.exit(1)
}

const prdContent = readFileSync(prdFile, 'utf-8')
const prdHash = 'sha256-' + createHash('sha256').update(prdContent).digest('hex')

const map = JSON.parse(readFileSync(mapFile, 'utf-8'))
map.prdHash = prdHash

writeFileSync(mapFile, JSON.stringify(map, null, 2) + '\n', 'utf-8')
console.log(`[OK] source-map.json prdHash 已冻结: ${prdHash}`)
process.exit(0)
