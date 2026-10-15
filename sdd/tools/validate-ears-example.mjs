#!/usr/bin/env node
// validate-ears-example.mjs — validate-ears.mjs 的用例矩阵测试（V01-V13）
// 用法: node sdd/tools/validate-ears-example.mjs
// 退出码: 0=全部通过, 1=有失败用例
// 用临时目录构造 specs/<feature>/spec.md，调用 validate-ears.mjs 验证预期退出码与错误类型

import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { execSync } from 'node:child_process'

const root = process.cwd()
const feature = 'ears-selftest'
const specDir = resolve('specs', feature)

function runValidator() {
  try {
    const out = execSync(`node sdd/tools/validate-ears.mjs ${feature} --json`, {
      cwd: root, encoding: 'utf-8', timeout: 30000, windowsHide: true
    })
    return { code: 0, report: JSON.parse(out) }
  } catch (e) {
    const out = e.stdout || ''
    try { return { code: 1, report: JSON.parse(out) } } catch { return { code: 1, report: null } }
  }
}

function setup(specContent) {
  rmSync(specDir, { recursive: true, force: true })
  mkdirSync(specDir, { recursive: true })
  writeFileSync(join(specDir, 'spec.md'), specContent, 'utf-8')
}

// 用例定义：{ id, name, spec, expectCode, expectTypes: [...] }
const cases = []

function addCase(id, name, acs, expectCode, expectTypes = []) {
  const spec = `# Feature: 自测

## 功能需求

### FR-001: 功能甲

描述。

**验收条件**：

${acs.fr || ''}

## 非功能需求

${acs.nfr || ''}
`
  cases.push({ id, name, spec, expectCode, expectTypes })
}

const AC_EVENT = '- AC-001: When 玩家点击登录按钮,\n  the 登录系统 shall 发起登录请求。'
const AC_STATE = '- AC-002: While 登录请求正在处理,\n  the 登录客户端 shall 禁止重复提交。'
const AC_IF = '- AC-003: If 登录请求返回账号不存在,\n  the 登录界面 shall 显示账号不存在提示。'
const AC_IF_THEN = '- AC-004: If 密码错误,\n  then the 登录系统 shall 返回统一错误提示。'
const AC_WHERE = '- AC-005: Where 自动战斗功能已开启,\n  the 战斗系统 shall 按自动战斗规则选择技能。'
const AC_UBIQ = '- AC-006: The 登录服务 shall 在 100 并发请求下保证 95% 响应不超过 500ms。'
const AC_COMPOUND = '- AC-007: While 玩家处于战斗状态, when 玩家生命值降至零,\n  the 战斗系统 shall 将玩家状态切换为死亡。'
const AC_COMPOUND_AND = '- AC-008: When 玩家提交表单 and 校验通过,\n  the 表单系统 shall 保存数据。'
const NFR_SIMPLE = '### NFR-001: 性能要求\n\n描述。\n\n**验收条件**：\n\n- AC-009: The 登录服务 shall 保证响应时间不超过 500ms。'

// V01 五句式正例
addCase('V01', '五句式正例', { fr: [AC_EVENT, AC_STATE, AC_IF, AC_WHERE].join('\n\n'), nfr: NFR_SIMPLE }, 0)

// V02 复合句式正例
addCase('V02', '复合句式正例', { fr: [AC_COMPOUND, AC_COMPOUND_AND].join('\n\n'), nfr: NFR_SIMPLE }, 0)

// V03 多行折行 AC
addCase('V03', '多行折行 AC', {
  fr: '- AC-001: When 玩家提交正确的账号和密码,\n  the 登录系统 shall 验证身份,\n  并创建登录会话。',
  nfr: NFR_SIMPLE
}, 0)

// V04 全角逗号归一化
addCase('V04', '全角逗号归一化', {
  fr: '- AC-001: When 玩家点击登录按钮，\n  the 登录系统 shall 发起登录请求。',
  nfr: NFR_SIMPLE
}, 0)

// V05 缺 shall
addCase('V05', '缺 shall', {
  fr: '- AC-001: When 玩家点击登录按钮, the 登录系统发起登录请求。',
  nfr: NFR_SIMPLE
}, 1, ['syntax'])

// V06 双 shall
addCase('V06', '双 shall 多行为', {
  fr: '- AC-001: When 玩家点击登录按钮, the 登录系统 shall 发起请求且 shall 显示动画。',
  nfr: NFR_SIMPLE
}, 1, ['multi-behavior'])

// V07 中文关键字
addCase('V07', '中文关键字', {
  fr: '- AC-001: 当玩家点击登录时，系统必须发起登录请求。',
  nfr: NFR_SIMPLE
}, 1, ['syntax'])

// V08 空条件段（When 后直接逗号，句式层即拒绝）
addCase('V08', '空条件段', {
  fr: '- AC-001: When , the 登录系统 shall 发起登录请求。',
  nfr: NFR_SIMPLE
}, 1, ['syntax'])

// V09 FR 无 AC
addCase('V09', 'FR 无 AC', { fr: '', nfr: NFR_SIMPLE }, 1, ['no-ac'])

// V10 NFR 无 AC
addCase('V10', 'NFR 无 AC', {
  fr: AC_EVENT,
  nfr: '### NFR-001: 性能要求\n\n描述。'
}, 1, ['no-ac'])

// V11 孤儿 AC（AC 出现在任何需求标题之前）
addCase('V11', '孤儿 AC', {
  fr: AC_EVENT,
  nfr: NFR_SIMPLE
}, 1, ['orphan-ac'])
// 覆写 spec：在正文开头插入无归属 AC
cases[cases.length - 1].spec = `# Feature: 自测

## 功能需求

- AC-002: When 任意事件发生,
  the 登录系统 shall 拦截重复提交。

### FR-001: 功能甲

描述。

**验收条件**：

${AC_EVENT}

## 非功能需求

${NFR_SIMPLE}
`

// V12 重复 AC ID（同一 FR 下出现两次 AC-001）
addCase('V12', '重复 AC ID', {
  fr: AC_EVENT + '\n\n- AC-001: If 密码错误,\n  the 登录系统 shall 返回错误。',
  nfr: NFR_SIMPLE
}, 1, ['duplicate-id'])

// V13 诊断格式（综合多种错误，验证输出含 target/type/message）
addCase('V13', '诊断格式综合', {
  fr: '- AC-001: 玩家登录成功。\n\n- AC-002: When 玩家点击, the 系统 shall 快速响应且 shall 记录日志。',
  nfr: '### NFR-001: 性能\n\n描述。'
}, 1, ['syntax', 'multi-behavior', 'no-ac'])

// --- 执行 ---

let passed = 0
let failed = 0

console.log(`validate-ears-example.mjs — 共 ${cases.length} 个用例\n`)

for (const c of cases) {
  setup(c.spec)
  const { code, report } = runValidator()

  let ok = code === c.expectCode
  let detail = `exit=${code} (期望 ${c.expectCode})`

  if (ok && c.expectTypes.length > 0) {
    const actualTypes = new Set((report?.errors || []).map(e => e.type))
    for (const t of c.expectTypes) {
      if (!actualTypes.has(t)) {
        ok = false
        detail += `，缺少错误类型 ${t}（实际: ${[...actualTypes].join(',') || '无'}）`
        break
      }
    }
    // 诊断三要素：target / type / message
    if (ok && report?.errors?.length > 0) {
      for (const e of report.errors) {
        if (!e.target || !e.type || !e.message) {
          ok = false
          detail += '，诊断缺少 target/type/message 三要素'
          break
        }
      }
    }
  }

  if (ok) {
    passed++
    console.log(`[PASS] ${c.id} ${c.name}`)
  } else {
    failed++
    console.error(`[FAIL] ${c.id} ${c.name} — ${detail}`)
    if (report?.errors) {
      console.error('  实际错误:', report.errors.map(e => `${e.target}[${e.type}]`).join(', ') || '无')
    }
  }
}

// 清理
rmSync(specDir, { recursive: true, force: true })

console.log(`\n结果: ${passed}/${cases.length} 通过, ${failed} 失败`)
process.exit(failed === 0 ? 0 : 1)
