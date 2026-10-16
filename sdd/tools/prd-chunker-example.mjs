#!/usr/bin/env node
// prd-chunker-example.mjs — prd-chunker + validate-chunks 的用例矩阵测试（C01-C10）
// 用法: node sdd/tools/prd-chunker-example.mjs
// 退出码: 0=全部通过, 1=有失败用例

import { writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { execFileSync } from 'node:child_process'

const root = process.cwd()
const feature = 'chunker-selftest'
const specDir = resolve('specs', feature)
const tmpPrd = resolve('specs', feature + '-prd.md')

function run(cmd) {
  try {
    const out = execFileSync('node', cmd, { cwd: root, encoding: 'utf-8', timeout: 30000, windowsHide: true, stdio: 'pipe' })
    return { code: 0, out }
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout || '') + (e.stderr || '') }
  }
}

function chunker(prdText, extra = []) {
  rmSync(specDir, { recursive: true, force: true })
  mkdirSync(specDir, { recursive: true })
  writeFileSync(tmpPrd, prdText, 'utf-8')
  return run(['sdd/tools/prd-chunker.mjs', feature, '--from', tmpPrd, '--force', ...extra])
}

function validate(extra = []) {
  return run(['sdd/tools/validate-chunks.mjs', feature, ...extra])
}

function readManifest() {
  return JSON.parse(readFileSync(join(specDir, 'intake', 'manifest.json'), 'utf-8'))
}
function readChunk(id) {
  return readFileSync(join(specDir, 'intake', 'chunks', id + '.md'), 'utf-8')
}

// --- fixtures ---

const headingDoc = `# 背包系统

背包基础说明。

## 堆叠规则

相同物品可堆叠。

堆叠上限 99。

## 扩容

第一期不支持扩容。

### 扩容道具

第二期实现。
`

function makeLongSection(paragraphs, prefix = '') {
  let s = ''
  for (let i = 0; i < paragraphs; i++) {
    s += `${prefix}第 ${i + 1} 段说明：物品获取后进入背包，背包按格子存储，相同物品优先堆叠，堆叠达到上限后占用新格子。\n\n`
  }
  return s
}

const tableDoc = `# 表格章节

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| itemId | string | 物品唯一标识 |
| count | number | 数量 |
| stackMax | number | 堆叠上限 |

表格后说明。
`

const fenceDoc = `# 代码章节

说明文字。

\`\`\`typescript
export interface Bag {
  items: BagItem[]

  add(item: BagItem): void
}
\`\`\`

围栏后说明。
`

const giantTable = `# 巨型表格\n\n` + Array.from({ length: 60 }, (_, i) => `| key${i} | value${i} | 说明内容第${i}条占用若干字符宽度 |`).join('\n') + '\n'

let passed = 0, failed = 0
const results = []

function check(id, name, ok, detail = '') {
  if (ok) { passed++; results.push(`[PASS] ${id} ${name}`) }
  else { failed++; results.push(`[FAIL] ${id} ${name} ${detail ? '— ' + detail : ''}`) }
}

// C01 多级标题
{
  const r = chunker(headingDoc, ['--budget', '50'])
  const v = validate()
  const m = readManifest()
  const paths = m.chunks.map(c => c.sectionPath.join('/'))
  check('C01', '多级标题切块', r.code === 0 && v.code === 0 && paths.includes('背包系统/堆叠规则') && paths.includes('背包系统/扩容/扩容道具'), `exit=${r.code}/${v.code} paths=${paths.join(';')}`)
}

// C02 表格不被切断
{
  const r = chunker(tableDoc, ['--budget', '30'])
  const v = validate()
  const m = readManifest()
  // 表格行应全部在同一个 chunk 的主区间内
  const tableLines = tableDoc.split('\n').map((l, i) => l.startsWith('|') ? i + 1 : null).filter(Boolean)
  const owners = new Set(tableLines.map(n => m.chunks.find(c => n >= c.lineStart && n <= c.lineEnd)?.chunkId))
  check('C02', '表格整块不切', r.code === 0 && v.code === 0 && owners.size === 1, `owners=${[...owners].join(',')}`)
}

// C03 代码围栏（内含空行）不切断
{
  const r = chunker(fenceDoc, ['--budget', '30'])
  const v = validate()
  const fenceLines = fenceDoc.split('\n').map((l, i) => (l.startsWith('```') || /Bag|add\(/.test(l)) ? i + 1 : null).filter(Boolean)
  const m = readManifest()
  const owners = new Set(fenceLines.map(n => m.chunks.find(c => n >= c.lineStart && n <= c.lineEnd)?.chunkId))
  check('C03', '围栏整块不切', r.code === 0 && v.code === 0 && owners.size === 1, `owners=${[...owners].join(',')}`)
}

// C04 超长章节按块拆分，主覆盖连续
{
  const doc = `# 长章节\n\n` + makeLongSection(40)
  const r = chunker(doc, ['--budget', '60'])
  const v = validate()
  const m = readManifest()
  check('C04', '超长章节拆分', r.code === 0 && v.code === 0 && m.chunkCount >= 5, `chunks=${m.chunkCount}`)
}

// C05 巨型表格超预算 → oversize 独立块不截断
{
  const r = chunker(giantTable, ['--budget', '100'])
  const v = validate()
  const m = readManifest()
  const os = m.chunks.filter(c => c.oversize)
  check('C05', '巨型原子块 oversize', r.code === 0 && v.code === 0 && os.length === 1, `oversize=${os.length}`)
}

// C06 组合 fixture 覆盖完整性（上面各用例已隐式验证，此处显式组合）
{
  const doc = headingDoc + tableDoc + '# 附录\n\n' + makeLongSection(10)
  const r = chunker(doc, ['--budget', '80'])
  const v = validate()
  check('C06', '组合 fixture', r.code === 0 && v.code === 0, `v=${v.out.slice(0, 80)}`)
}

// C07 删除原文一行 → 拒绝
{
  chunker(headingDoc, ['--budget', '50'])
  const prdFile = join(specDir, 'source-prd.md')
  const lines = readFileSync(prdFile, 'utf-8').split('\n')
  lines.splice(3, 1)
  writeFileSync(prdFile, lines.join('\n'), 'utf-8')
  const v = validate()
  check('C07', '删原文行被拒', v.code === 1, `exit=${v.code}`)
}

// C08 篡改 Chunk 文件 → 拒绝
{
  chunker(headingDoc, ['--budget', '50'])
  const f = join(specDir, 'intake', 'chunks', 'CHUNK-001.md')
  writeFileSync(f, readFileSync(f, 'utf-8') + '篡改内容', 'utf-8')
  const v = validate()
  check('C08', '篡改 Chunk 被拒', v.code === 1, `exit=${v.code}`)
}

// C09 overlap 开启：overlapStart 落在前块主区间
{
  const doc = `# 长章节\n\n` + makeLongSection(20)
  const r = chunker(doc, ['--budget', '60', '--overlap', '1'])
  const v = validate()
  const m = readManifest()
  const withOv = m.chunks.filter(c => c.overlapStart !== null)
  const ok = withOv.length > 0 && withOv.every(c => {
    const prev = m.chunks.find(p => p.lineEnd === c.lineStart - 1)
    return prev && c.overlapStart >= prev.lineStart && c.overlapStart <= prev.lineEnd
  })
  check('C09', 'overlap 后缀一致', r.code === 0 && v.code === 0 && ok, `withOverlap=${withOv.length}`)
}

// C10 稳定性：两次运行 manifest 逐字节一致
{
  chunker(headingDoc + tableDoc, ['--budget', '40'])
  const m1 = readFileSync(join(specDir, 'intake', 'manifest.json'))
  chunker(headingDoc + tableDoc, ['--budget', '40'])
  const m2 = readFileSync(join(specDir, 'intake', 'manifest.json'))
  check('C10', '同输入两次一致', m1.equals(m2))
}

// 探针模式附带验证
{
  const e1 = run(['sdd/tools/validate-chunks.mjs', feature, '--exists', 'CHUNK-001'])
  const e2 = run(['sdd/tools/validate-chunks.mjs', feature, '--exists', 'CHUNK-999'])
  check('C10b', '--exists 探针', e1.code === 0 && e2.code === 1, `${e1.code}/${e2.code}`)
}

// 清理
rmSync(specDir, { recursive: true, force: true })
rmSync(tmpPrd, { force: true })

console.log(`prd-chunker-example.mjs — 共 ${passed + failed} 个用例\n`)
results.forEach(r => console.log(r))
console.log(`\n结果: ${passed}/${passed + failed} 通过, ${failed} 失败`)
process.exit(failed === 0 ? 0 : 1)
