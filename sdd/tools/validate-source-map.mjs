#!/usr/bin/env node
// validate-source-map.mjs — Source Coverage Gate：原始 PRD 需求到 Spec 的防遗漏确定性校验
// 用法: node sdd/tools/validate-source-map.mjs <feature> [--json]
// 退出码: 0=通过, 1=失败
// 检查规则见 dev-docs/planning/EARS改造-P2-执行文档.md E2-T02 与 sdd/rules/source-extraction.md
//
// 错误类型枚举:
//   structure              source-map.json 结构/解析问题
//   duplicate-id           SRC ID 重复
//   bad-id                 SRC ID 格式错误
//   missing-mapping        SRC 缺少 mapping
//   extra-mapping          mapping 引用不存在的 SRC 或重复
//   disposition            disposition 枚举/一致性问题（pending 带映射等）
//   note-required          excluded/pending 缺少理由
//   empty-requirement      covered 但 requirementIds 为空 / 非 covered 却带映射
//   unknown-id             引用的 FR/NFR/AC 在 spec.md 中不存在
//   ownership              AC 归属与映射的 requirement 不符
//   unsupported-requirement spec 中的 FR/NFR 无任何 SRC 依据（反向防漏核心）
//   prd-hash               prdHash 与 source-prd.md 实际哈希不符

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { parseSpec } from './spec-parser.mjs'

function readFile(path) {
  let content = readFileSync(path, 'utf-8')
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1)
  return content
}

const args = process.argv.slice(2)
const jsonMode = args.includes('--json')
const feature = args.find(a => !a.startsWith('--'))

if (!feature) {
  console.error('Usage: node sdd/tools/validate-source-map.mjs <feature> [--json]')
  process.exit(1)
}

const dir = resolve('specs', feature)
const mapFile = resolve(dir, 'source-map.json')
const prdFile = resolve(dir, 'source-prd.md')
const specFile = resolve(dir, 'spec.md')

const errors = []
let parsed = null
let map = null

function fail(msg, list = errors) {
  list.push(msg)
}

// --- 1. 文件与结构 ---
if (!existsSync(mapFile)) {
  fail({ target: 'source-map', type: 'structure', message: `source-map.json 不存在: ${mapFile}` })
} else {
  try {
    map = JSON.parse(readFile(mapFile))
  } catch (e) {
    fail({ target: 'source-map', type: 'structure', message: `JSON 解析失败: ${e.message}` })
    map = null
  }
}

if (map) {
  if (map.feature !== feature) {
    fail({ target: 'source-map', type: 'structure', message: `feature 不匹配: map=${map.feature}, expected=${feature}` })
  }
  if (!Array.isArray(map.sources) || map.sources.length === 0) {
    fail({ target: 'source-map', type: 'structure', message: 'sources 缺失或为空数组' })
  }
  if (!Array.isArray(map.mappings)) {
    fail({ target: 'source-map', type: 'structure', message: 'mappings 缺失或非数组' })
  }
}

// --- 2. SRC ID 检查 + 一一对应 ---
const srcIds = []
if (map && Array.isArray(map.sources)) {
  const seen = new Set()
  for (const s of map.sources) {
    const id = s.sourceId
    if (!id || !/^SRC-\d{3}$/.test(id)) {
      fail({ target: id || 'sources', type: 'bad-id', message: `SRC ID 格式错误: ${id}（应为 SRC-NNN 三位数字）` })
      continue
    }
    if (seen.has(id)) {
      fail({ target: id, type: 'duplicate-id', message: 'SRC ID 重复' })
    }
    seen.add(id)
    srcIds.push(id)
    if (!s.text || String(s.text).trim().length === 0) {
      fail({ target: id, type: 'structure', message: 'text 为空' })
    }
    if (s.status !== 'confirmed' && s.status !== 'assumed') {
      fail({ target: id, type: 'structure', message: `status "${s.status}" 不在枚举 confirmed|assumed 中` })
    }
  }
}

// spec 解析（供引用校验与反向防漏）
if (existsSync(specFile)) {
  parsed = parseSpec(readFile(specFile))
} else {
  fail({ target: 'spec', type: 'structure', message: 'spec.md 不存在' })
}

// mappings 校验
const coveredReqs = new Set()
if (map && Array.isArray(map.mappings)) {
  const mappedSrc = new Map()
  for (const m of map.mappings) {
    const id = m.sourceId
    if (!id || !srcIds.includes(id)) {
      fail({ target: id || 'mappings', type: 'extra-mapping', message: `mapping 引用了不存在的 SRC: ${id}` })
      continue
    }
    if (mappedSrc.has(id)) {
      fail({ target: id, type: 'extra-mapping', message: 'SRC 有多条 mapping（必须一一对应）' })
      continue
    }
    mappedSrc.set(id, m)

    // disposition 枚举
    const d = m.disposition
    if (!['covered', 'excluded', 'pending'].includes(d)) {
      fail({ target: id, type: 'disposition', message: `disposition "${d}" 不在枚举 covered|excluded|pending 中` })
      continue
    }

    // note 约束
    if ((d === 'excluded' || d === 'pending') && (!m.note || String(m.note).trim().length === 0)) {
      fail({ target: id, type: 'note-required', message: `disposition=${d} 但缺少 note 理由（不允许静默丢失）` })
    }

    // 映射内容与 disposition 一致性
    const reqIds = m.requirementIds || []
    const acIds = m.acceptanceIds || []
    if (d === 'covered') {
      if (reqIds.length === 0) {
        fail({ target: id, type: 'empty-requirement', message: 'covered 但 requirementIds 为空' })
      }
    } else {
      if (reqIds.length > 0 || acIds.length > 0) {
        fail({ target: id, type: 'disposition', message: `disposition=${d} 但携带了映射（应仅 covered 可映射）` })
      }
    }

    // 引用存在性与归属（需要 spec）
    if (parsed && d === 'covered') {
      const knownReqs = new Set([...parsed.frIds, ...parsed.nfrIds])
      for (const r of reqIds) {
        if (!knownReqs.has(r)) {
          fail({ target: id, type: 'unknown-id', message: `requirementId "${r}" 在 spec.md 中不存在` })
        } else {
          coveredReqs.add(r)
        }
      }
      for (const a of acIds) {
        const owner = parsed.acToReq[a]
        if (!owner) {
          fail({ target: id, type: 'unknown-id', message: `acceptanceId "${a}" 在 spec.md 中不存在` })
        } else if (!reqIds.includes(owner)) {
          fail({ target: id, type: 'ownership', message: `AC ${a} 属于 ${owner}，不能映射到 ${reqIds.join(', ')}` })
        }
      }
    }
  }

  // 缺 mapping 的 SRC
  for (const id of srcIds) {
    if (!mappedSrc.has(id)) {
      fail({ target: id, type: 'missing-mapping', message: 'SRC 缺少 mapping（每条原始需求必须有处置结果）' })
    }
  }

  // --- 3. 反向防漏：spec 的每个 FR/NFR 必须有 SRC 依据 ---
  if (parsed) {
    for (const reqId of [...parsed.frIds, ...parsed.nfrIds]) {
      if (!coveredReqs.has(reqId)) {
        fail({
          target: reqId,
          type: 'unsupported-requirement',
          message: 'spec 中该需求未追溯到任何 SRC（无 PRD 依据的新增；确属必要请先补 PRD 再重跑 Intake）'
        })
      }
    }
  }
}

// --- 4. prdHash ---
if (map) {
  if (!existsSync(prdFile)) {
    fail({ target: 'source-prd', type: 'prd-hash', message: 'source-prd.md 不存在' })
  } else {
    const actual = 'sha256-' + createHash('sha256').update(readFile(prdFile)).digest('hex')
    if (map.prdHash !== actual) {
      fail({
        target: 'source-map',
        type: 'prd-hash',
        message: `prdHash 不匹配（map=${map.prdHash ? '有值' : '空'}, actual=${actual.slice(0, 20)}...；请运行 freeze-source-map.mjs）`
      })
    }
  }
}

// --- 输出 ---
const uniqueErrors = []
const seenKeys = new Set()
for (const e of errors) {
  const key = `${e.target}|${e.type}|${e.message}`
  if (!seenKeys.has(key)) {
    seenKeys.add(key)
    uniqueErrors.push(e)
  }
}

const stats = {
  sources: srcIds.length,
  mappings: map && Array.isArray(map.mappings) ? map.mappings.length : 0,
  covered: map && Array.isArray(map.mappings) ? map.mappings.filter(m => m.disposition === 'covered').length : 0,
  excluded: map && Array.isArray(map.mappings) ? map.mappings.filter(m => m.disposition === 'excluded').length : 0,
  pending: map && Array.isArray(map.mappings) ? map.mappings.filter(m => m.disposition === 'pending').length : 0,
  specRequirements: parsed ? parsed.requirements.length : 0,
  errors: uniqueErrors.length
}

if (jsonMode) {
  console.log(JSON.stringify({ valid: uniqueErrors.length === 0, feature, stats, errors: uniqueErrors }, null, 2))
} else if (uniqueErrors.length === 0) {
  console.log('[OK] Source Coverage Gate 通过')
  console.log(`  SRC: ${stats.sources} 条（covered ${stats.covered}, excluded ${stats.excluded}, pending ${stats.pending}）`)
  console.log(`  Spec 需求: ${stats.specRequirements} 个，全部有 SRC 依据`)
  console.log(`  prdHash: 校验一致`)
} else {
  console.error(`[FAIL] Source Coverage Gate 未通过（${uniqueErrors.length} 处问题）:`)
  for (const e of uniqueErrors) {
    console.error(`  - ${e.target} [${e.type}] ${e.message}`)
  }
}

process.exit(uniqueErrors.length === 0 ? 0 : 1)
