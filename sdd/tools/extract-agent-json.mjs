#!/usr/bin/env node
// extract-agent-json.mjs — 参数化 journal 提取：按 label + agentType 取最新一次 Agent 的 JSON 输出
// 用法: node sdd/tools/extract-agent-json.mjs --label <label> [--agentType explore] --out <outputFile> [--journal <journalFile>]
// 机制仿照 extract-review.mjs，但：
// 1. 不写死标签与 JSON 结构（结构校验交给后续 validate-* 工具）
// 2. 同 label 多轮匹配时取【最新】entry（修复循环后避免读到旧轮输出）
// 3. 解析失败保存 .raw 兜底
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'

function arg(name) {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : null
}

const label = arg('--label')
const agentType = arg('--agentType') || 'explore'
const outputFile = arg('--out')
let journalFile = arg('--journal')

if (!label || !outputFile) {
  console.error('Usage: extract-agent-json.mjs --label <label> [--agentType explore] --out <file> [--journal <file>]')
  process.exit(1)
}

function readFile(path) {
  let content = readFileSync(path, 'utf-8')
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1)
  return content
}

// 未指定 journal 时自动选最新
if (!journalFile) {
  const journalDir = resolve('.opencode-workflows/journal')
  try {
    const files = readdirSync(journalDir)
      .filter(f => f.endsWith('.json'))
      .map(f => ({ name: f, path: join(journalDir, f), mtime: statSync(join(journalDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
    if (files.length === 0) {
      console.error('未找到 journal 文件')
      process.exit(1)
    }
    journalFile = files[0].path
    console.log(`[extract-agent-json] 自动选择 journal: ${files[0].name}`)
  } catch (e) {
    console.error('读取 journal 目录失败:', e.message)
    process.exit(1)
  }
}

const journal = JSON.parse(readFile(journalFile))
const entries = journal.entries || {}
const keys = Object.keys(entries)

if (keys.length === 0) {
  console.error('Journal 中无 agent 记录')
  process.exit(1)
}

// 取最新一次匹配 entry（keys 保持插入顺序，靠后为最新）
let entry = null
let entryKey = null
for (const k of keys) {
  const e = entries[k]
  if (e.label === label && e.agentType === agentType && e.result) {
    entry = e
    entryKey = k
  }
}

if (!entry) {
  console.error(`未找到符合条件的 entry (label=${label}, agentType=${agentType})`)
  console.error('Journal entries:', keys.map(k => `${k}: label=${entries[k].label}, agentType=${entries[k].agentType}, hasResult=${!!entries[k].result}`).join('; '))
  process.exit(1)
}

console.log(`[extract-agent-json] 匹配 entry: ${entryKey} (label=${entry.label}, agentType=${entry.agentType}, 取最新匹配)`)

let resultText = entry.result

// 剥离 markdown 围栏
resultText = resultText.replace(/^```json\s*/m, '').replace(/^```\s*/m, '').replace(/\s*```\s*$/m, '').trim()

// 直接解析 → 花括号截取
let obj
try {
  obj = JSON.parse(resultText)
} catch (e) {
  const firstBrace = resultText.indexOf('{')
  const lastBrace = resultText.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    try {
      obj = JSON.parse(resultText.slice(firstBrace, lastBrace + 1))
      console.log('[extract-agent-json] 从文本中提取 JSON 成功')
    } catch (e2) {
      console.error('JSON 提取失败:', e2.message)
      const rawPath = outputFile + '.raw'
      mkdirSync(dirname(resolve(outputFile)), { recursive: true })
      writeFileSync(rawPath, resultText, 'utf-8')
      console.error('原始文本已保存到:', rawPath)
      process.exit(1)
    }
  } else {
    console.error('文本中未找到 JSON 对象')
    const rawPath = outputFile + '.raw'
    mkdirSync(dirname(resolve(outputFile)), { recursive: true })
    writeFileSync(rawPath, resultText, 'utf-8')
    console.error('原始文本已保存到:', rawPath)
    process.exit(1)
  }
}

const outPath = resolve(outputFile)
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, JSON.stringify(obj, null, 2) + '\n', 'utf-8')
console.log(`[extract-agent-json] ${outputFile} 已写入`)
