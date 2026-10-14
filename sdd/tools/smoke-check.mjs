#!/usr/bin/env node
// P0.1 烟雾测试校验：检查 fixtures/<feature>-app/smoke-test.txt 存在且非空
// 退出码：0=通过，1=未通过
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const feature = process.argv[2]
if (!feature) {
  console.error('Usage: node smoke-check.mjs <feature>')
  process.exit(1)
}

const file = resolve('fixtures', `${feature}-app`, 'smoke-test.txt')

if (!existsSync(file)) {
  console.error(`[FAIL] ${file} 不存在`)
  process.exit(1)
}

const content = readFileSync(file, 'utf-8').trim()
if (content.length === 0) {
  console.error(`[FAIL] ${file} 内容为空`)
  process.exit(1)
}

console.log(`[OK] ${file} 存在且非空（${content.length} 字符）`)
process.exit(0)
