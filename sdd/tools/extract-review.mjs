#!/usr/bin/env node
// extract-review.mjs — 从工作流 journal 提取 Reviewer 的 JSON 输出，写入 review.json
// 用法: node sdd/tools/extract-review.mjs <outputFile> [journalFile]
// 校验：只提取 label=Audit-Reviewer + agentType=explore 的 entry，拒绝其他
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'

let [outputFile, journalFile] = process.argv.slice(2)

if (!outputFile) {
  console.error('Usage: extract-review.mjs <outputFile> [journalFile]')
  process.exit(1)
}

function readFile(path) {
  let content = readFileSync(path, 'utf-8')
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1)
  return content
}

// 如果未指定 journalFile，查找最新的 journal 文件
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
    console.log(`[extract-review] 自动选择 journal: ${files[0].name}`)
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

// 严格校验：只接受 label=Audit-Reviewer + agentType=explore 的 entry
let entry = null
let entryKey = null
for (const k of keys) {
  const e = entries[k]
  if (e.label === 'Audit-Reviewer' && e.agentType === 'explore' && e.result) {
    entry = e
    entryKey = k
    break
  }
}

if (!entry) {
  console.error('未找到符合条件的 Audit-Reviewer (label=Audit-Reviewer, agentType=explore) entry')
  console.error('Journal entries:', keys.map(k => `${k}: label=${entries[k].label}, agentType=${entries[k].agentType}, hasResult=${!!entries[k].result}`).join('; '))
  process.exit(1)
}

console.log(`[extract-review] 匹配 entry: ${entryKey} (label=${entry.label}, agentType=${entry.agentType})`)

let resultText = entry.result

// 移除 markdown 围栏（如果存在）
resultText = resultText.replace(/^```json\s*/m, '').replace(/\s*```\s*$/m, '').trim()

// 尝试直接解析
let reviewObj
try {
  reviewObj = JSON.parse(resultText)
} catch (e) {
  // 直接解析失败，尝试从文本中提取 JSON 对象
  const firstBrace = resultText.indexOf('{')
  const lastBrace = resultText.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    let jsonCandidate = resultText.slice(firstBrace, lastBrace + 1)
    // 修复常见 LLM 输出畸形：key 后缺少值，如 "reason","fileRef" → "reason":"","fileRef"
    const knownKeys = ['ac','type','testId','result','reason','fileRef','approver','id','status','evidenceRefs','verifications','finding','feature','round','specHash','reviewerLabel','requirements']
    knownKeys.forEach(key => {
      const pattern = new RegExp('"' + key + '","(' + knownKeys.join('|') + ')"', 'g')
      jsonCandidate = jsonCandidate.replace(pattern, '"' + key + '":"","$1"')
    })
    try {
      reviewObj = JSON.parse(jsonCandidate)
      console.log('[extract-review] 从文本中提取并修复 JSON 成功')
    } catch (e2) {
      console.error('JSON 提取修复失败:', e2.message)
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

// 校验 reviewObj 结构
if (!reviewObj.requirements || !Array.isArray(reviewObj.requirements)) {
  console.error('review.json 缺少 requirements 数组')
  process.exit(1)
}

// 写入格式化 JSON
const outPath = resolve(outputFile)
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, JSON.stringify(reviewObj, null, 2) + '\n', 'utf-8')
console.log(`[extract-review] ${outputFile} (${reviewObj.requirements.length} requirements)`)
