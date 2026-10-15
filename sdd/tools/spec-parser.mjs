#!/usr/bin/env node
// spec-parser.mjs — 统一 Spec 解析器（FR/NFR/AC 结构解析的唯一实现）
// 被 coverage.mjs / audit-spec-parse.mjs / validate-ears.mjs / validate-review.mjs / is-converged.mjs / audit-converge.mjs 共用
// 职责边界：只做结构解析，不做 EARS 句式判断（句式判断归 validate-ears.mjs）
//
// 解析规则：
// 1. 需求标题：### FR-NNN: / ### NFR-NNN:（三位数字，与 coverage 历史口径一致）
// 2. AC 块：以 "- AC-NNN:" 开始，后续以空白开头的行并入该块，直到下一个 AC/标题/非缩进行
// 3. 去除 BOM；续行空白折叠为单个空格

const REQ_RE = /^###\s+(FR-\d{3}|NFR-\d{3}):?\s*(.*)$/
const AC_START_RE = /^-\s+(AC-\d{3}):\s*(.*)$/

// 解析 spec 文本，返回结构化对象（纯函数，无副作用）
export function parseSpec(content) {
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1)

  const lines = content.split('\n')
  const frIds = []
  const nfrIds = []
  const acToReq = new Map()
  const requirements = []
  const orphanACs = []
  let current = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const reqMatch = line.match(REQ_RE)
    if (reqMatch) {
      current = {
        id: reqMatch[1],
        type: reqMatch[1].startsWith('FR-') ? 'FR' : 'NFR',
        title: (reqMatch[2] || '').trim(),
        acs: []
      }
      requirements.push(current)
      if (current.type === 'FR') frIds.push(current.id)
      else nfrIds.push(current.id)
      continue
    }

    const acMatch = line.match(AC_START_RE)
    if (acMatch) {
      const ac = {
        id: acMatch[1],
        text: (acMatch[2] || '').trim(),
        line: i + 1
      }
      // 收集续行：以空白开头的行并入本 AC，直到遇到 AC/标题/非缩进行
      let j = i + 1
      while (j < lines.length) {
        const next = lines[j]
        if (next.startsWith(' ') || next.startsWith('\t')) {
          const stripped = next.trim()
          if (stripped.length > 0 && !AC_START_RE.test(stripped) && !REQ_RE.test(stripped)) {
            ac.text += ' ' + stripped
          }
          j++
        } else {
          break
        }
      }
      i = j - 1
      if (current) {
        current.acs.push(ac)
        acToReq.set(ac.id, current.id)
      } else {
        orphanACs.push({ id: ac.id, line: ac.line })
      }
      continue
    }
  }

  const acIds = requirements.flatMap(r => r.acs.map(a => a.id))
  return {
    frIds,
    nfrIds,
    acIds,               // 含孤儿 AC 之外的归属 AC；孤儿单独列出
    acToReq: Object.fromEntries(acToReq),
    requirements,
    orphanACs
  }
}

// 便捷方法：全部 AC（含孤儿）的 ID 列表
export function allACIds(parsed) {
  return [...parsed.acIds, ...parsed.orphanACs.map(o => o.id)]
}
