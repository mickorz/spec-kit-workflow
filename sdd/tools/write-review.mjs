#!/usr/bin/env node
// write-review.mjs — 从文件或 stdin 读取 Reviewer 输出的 JSON 文本，清理后写入 review.json
// 用法:
//   node write-review.mjs <inputFile> <outputFile>
//   echo '<json>' | node write-review.mjs <outputFile>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'

function processContent(content, outputFile) {
  try {
    content = content.replace(/^```json\s*/m, '').replace(/\s*```\s*$/m, '').trim()
    const parsed = JSON.parse(content)
    const outPath = resolve(outputFile)
    mkdirSync(dirname(outPath), { recursive: true })
    writeFileSync(outPath, JSON.stringify(parsed, null, 2) + '\n', 'utf-8')
    console.log(`[write-review] ${outputFile} (${parsed.requirements?.length || 0} requirements)`)
  } catch (e) {
    console.error(`[write-review] JSON 解析失败: ${e.message}`)
    const outPath = resolve(outputFile)
    mkdirSync(dirname(outPath), { recursive: true })
    writeFileSync(outPath + '.raw', content, 'utf-8')
    process.exit(1)
  }
}

const args = process.argv.slice(2)
if (args.length >= 2) {
  const content = readFileSync(args[0], 'utf-8')
  processContent(content, args[1])
} else if (args.length === 1) {
  let content = ''
  process.stdin.setEncoding('utf-8')
  process.stdin.on('data', chunk => { content += chunk })
  process.stdin.on('end', () => processContent(content, args[0]))
} else {
  console.error('Usage: write-review.mjs <inputFile> <outputFile> | write-review.mjs <outputFile>')
  process.exit(1)
}
