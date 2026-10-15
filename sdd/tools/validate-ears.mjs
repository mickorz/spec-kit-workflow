#!/usr/bin/env node
// validate-ears.mjs — EARS 确定性格式校验器（无 LLM 参与）
// 用法: node sdd/tools/validate-ears.mjs <feature> [--json]
// 退出码: 0=通过, 1=失败
// 校验规则见 sdd/rules/ears-format.md 与 dev-docs/planning/EARS改造-P0-执行文档.md E0-T04
//
// 错误类型枚举:
//   syntax        不符合任何 EARS 句式（缺关键字/结构错误）
//   multi-behavior 一条 AC 包含多个 shall 子句
//   empty-segment 条件段/主体段/行为段为空或过短
//   no-ac         FR/NFR 没有任何验收条件
//   orphan-ac     AC 不归属任何 FR/NFR
//   duplicate-id  ID 重复
//   bad-id        ID 格式错误

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseSpec, allACIds } from './spec-parser.mjs'

function readFile(path) {
  let content = readFileSync(path, 'utf-8')
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1)
  return content
}

// --- EARS 句式正则（对归一化文本匹配）---

const RE = {
  COMPOUND: /^While\s+\S.*?,\s*when\s+\S.*?,\s*the\s+\S.*?\s+shall\s+\S.*$/,
  EVENT:    /^When\s+\S.*?,\s*the\s+\S.*?\s+shall\s+\S.*$/,
  STATE:    /^While\s+\S.*?,\s*the\s+\S.*?\s+shall\s+\S.*$/,
  UNWANTED: /^If\s+\S.*?,\s*(?:then\s+)?the\s+\S.*?\s+shall\s+\S.*$/,
  OPTIONAL: /^Where\s+\S.*?,\s*the\s+\S.*?\s+shall\s+\S.*$/,
  UBIQ:     /^The\s+\S.*?\s+shall\s+\S.*$/
}
const PATTERN_NAMES = {
  COMPOUND: '复合句式(While+When)',
  EVENT: '事件驱动(When)',
  STATE: '状态驱动(While)',
  UNWANTED: '异常处理(If)',
  OPTIONAL: '可选功能(Where)',
  UBIQ: '全局约束(The shall)'
}

// 归一化：全角逗号转半角、空白折叠、去首尾空白
function normalize(text) {
  return text
    .replace(/，/g, ', ')
    .replace(/\s+/g, ' ')
    .trim()
}

// 匹配句式，返回命中的句式名数组（应为 0 或 1 个）
function matchPatterns(normalized) {
  const hits = []
  for (const [name, re] of Object.entries(RE)) {
    if (re.test(normalized)) hits.push(name)
  }
  return hits
}

// --- 主逻辑 ---

const args = process.argv.slice(2)
const jsonMode = args.includes('--json')
const feature = args.find(a => !a.startsWith('--'))

if (!feature) {
  console.error('Usage: node sdd/tools/validate-ears.mjs <feature> [--json]')
  process.exit(1)
}

const specFile = resolve('specs', feature, 'spec.md')
const errors = []

if (!existsSync(specFile)) {
  const msg = { valid: false, feature, errors: [{ target: 'spec', type: 'no-file', message: `spec.md 不存在: ${specFile}` }] }
  if (jsonMode) console.log(JSON.stringify(msg, null, 2))
  else console.error(`[FAIL] spec.md 不存在: ${specFile}`)
  process.exit(1)
}

const specContent = readFile(specFile)
const parsed = parseSpec(specContent)

// --- 1. 结构规则 ---

// ID 格式（解析器已按三位数字解析；这里检查正文中是否出现不符合位数的 ID 写法）
for (const m of specContent.matchAll(/\b((?:FR|NFR|AC)-\d+)\b/g)) {
  if (!/^\d{3}$/.test(m[1].split('-')[1])) {
    errors.push({ target: m[1], type: 'bad-id', message: `ID "${m[1]}" 不是三位数字格式` })
  }
}

// ID 重复（FR/NFR/AC 全部 ID 池）
{
  const allIds = [...parsed.frIds, ...parsed.nfrIds, ...allACIds(parsed)]
  const seen = new Set()
  for (const id of allIds) {
    if (seen.has(id)) {
      errors.push({ target: id, type: 'duplicate-id', message: `ID "${id}" 重复出现` })
    }
    seen.add(id)
  }
}

// 孤儿 AC（不归属任何 FR/NFR）
for (const orphan of parsed.orphanACs) {
  errors.push({
    target: orphan.id,
    type: 'orphan-ac',
    message: `AC 不归属任何 FR/NFR（spec.md:${orphan.line}）`
  })
}

// 每个需求至少一条 AC
for (const req of parsed.requirements) {
  if (req.acs.length === 0) {
    errors.push({ target: req.id, type: 'no-ac', message: `${req.type === 'FR' ? '功能' : '非功能'}需求没有任何验收条件` })
  }
}

// --- 2. 句式规则（逐 AC）---

for (const req of parsed.requirements) {
  for (const ac of req.acs) {
    const normalized = normalize(ac.text)

    if (normalized.length === 0) {
      errors.push({ target: ac.id, type: 'empty-segment', message: `AC 内容为空（spec.md:${ac.line}）` })
      continue
    }

    // 多 shall 检查（在归一化前检查原文，避免行为段里恰好包含 shall 字样的误判——shall 是关键字，出现即计）
    const shallCount = (normalized.match(/\bshall\b/g) || []).length
    if (shallCount === 0) {
      errors.push({
        target: ac.id,
        type: 'syntax',
        message: `缺少 shall 行为子句（spec.md:${ac.line}）`
      })
      continue
    }
    if (shallCount > 1) {
      errors.push({
        target: ac.id,
        type: 'multi-behavior',
        message: `包含 ${shallCount} 个 shall 子句，应拆分为多条 AC（spec.md:${ac.line}）`
      })
      continue
    }

    const hits = matchPatterns(normalized)
    if (hits.length === 0) {
      errors.push({
        target: ac.id,
        type: 'syntax',
        message: `不符合任何 EARS 句式，触发关键字须为 When/While/If/Where/The 且结构为 条件 逗号 the 主体 shall 行为（spec.md:${ac.line}）`
      })
      continue
    }

    // 段落非空检查（拆解命中的句式验证三段均 >= 2 字符；UBIQ 无条件段，跳过条件检查）
    const seg = splitSegments(normalized, hits[0])
    if (seg) {
      const checks = []
      if (seg.condition !== null) checks.push(['条件', seg.condition])
      checks.push(['主体', seg.subject], ['行为', seg.action])
      for (const [name, value] of checks) {
        if (!value || value.replace(/\s/g, '').length < 2) {
          errors.push({
            target: ac.id,
            type: 'empty-segment',
            message: `${name}段为空或过短（spec.md:${ac.line}）`
          })
        }
      }
    }
  }
}

// 按句式拆解三段
function splitSegments(normalized, patternName) {
  const body = normalized
  try {
    switch (patternName) {
      case 'COMPOUND': {
        const m = body.match(/^While\s+(.+?),\s*when\s+(.+?),\s*the\s+(.+?)\s+shall\s+(.+)$/)
        return m ? { condition: m[1] + ' / ' + m[2], subject: m[3], action: m[4] } : null
      }
      case 'EVENT':
      case 'STATE':
      case 'UNWANTED':
      case 'OPTIONAL': {
        const m = body.match(/^(?:When|While|If|Where)\s+(.+?),\s*(?:then\s+)?the\s+(.+?)\s+shall\s+(.+)$/)
        return m ? { condition: m[1], subject: m[2], action: m[3] } : null
      }
      case 'UBIQ': {
        const m = body.match(/^The\s+(.+?)\s+shall\s+(.+)$/)
        return m ? { condition: null, subject: m[1], action: m[2] } : null
      }
    }
  } catch {
    return null
  }
  return null
}

// --- 输出 ---

function output() {
  const uniqueErrors = dedupe(errors)
  const report = {
    valid: uniqueErrors.length === 0,
    feature,
    specFile,
    stats: {
      requirements: parsed.requirements.length,
      fr: parsed.frIds.length,
      nfr: parsed.nfrIds.length,
      ac: allACIds(parsed).length,
      errors: uniqueErrors.length
    },
    errors: uniqueErrors
  }
  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    if (report.valid) {
      console.log('[OK] EARS 格式校验通过')
      console.log(`  FR: ${report.stats.fr} 个, NFR: ${report.stats.nfr} 个, AC: ${report.stats.ac} 条，全部符合 EARS 句式`)
    } else {
      console.error(`[FAIL] EARS 校验失败（${uniqueErrors.length} 处问题）:`)
      for (const e of uniqueErrors) {
        console.error(`  - ${e.target} [${e.type}] ${e.message}`)
      }
    }
  }
}

function dedupe(list) {
  const seen = new Set()
  return list.filter(e => {
    const key = `${e.target}|${e.type}|${e.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

output()
process.exit(errors.length === 0 ? 0 : 1)
