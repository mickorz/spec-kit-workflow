#!/usr/bin/env node
// snapshot.mjs — 源代码文件快照（哈希），用于审计只读保护
// 用法:
//   快照: node sdd/tools/snapshot.mjs snapshot <dir> <output.json> [--patterns src/**/*.ts,tests/**/*.ts]
//   对比: node sdd/tools/snapshot.mjs compare <before.json> <after.json>
// 对比模式: 有变化则 exit 1，无变化 exit 0

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from 'node:fs'
import { resolve, join, relative } from 'node:path'
import { createHash } from 'node:crypto'

function readFile(path) {
  let content = readFileSync(path, 'utf-8')
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1)
  return content
}

function fileHash(filePath) {
  const content = readFileSync(filePath)
  return 'sha256-' + createHash('sha256').update(content).digest('hex')
}

// glob 匹配
function globToRegex(pattern) {
  let result = ''
  let i = 0
  while (i < pattern.length) {
    if (pattern[i] === '*' && pattern[i + 1] === '*') {
      if (pattern[i + 2] === '/') {
        result += '(?:[^/]*/)*'
        i += 3
      } else {
        result += '.*'
        i += 2
      }
    } else if (pattern[i] === '*') {
      result += '[^/]*'
      i++
    } else if (pattern[i] === '.') {
      result += '\\.'
      i++
    } else if (pattern[i] === '?') {
      result += '[^/]'
      i++
    } else {
      result += pattern[i]
      i++
    }
  }
  return new RegExp('^' + result + '$')
}

function globMatch(baseDir, patterns) {
  const results = new Set()
  for (const pattern of patterns) {
    const regex = globToRegex(pattern)
    function walk(dir) {
      if (!existsSync(dir)) return
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        const rel = relative(baseDir, full).replace(/\\/g, '/')
        if (statSync(full).isDirectory()) {
          walk(full)
        } else if (regex.test(rel)) {
          results.add(rel)
        }
      }
    }
    walk(baseDir)
  }
  return [...results].sort()
}

const mode = process.argv[2]

if (mode === 'snapshot') {
  const dir = process.argv[3]
  const outputFile = process.argv[4]
  const outputDir = resolve(outputFile).replace(/[/\\][^/\\]+$/, '')
  mkdirSync(outputDir, { recursive: true })
  const patternsArg = process.argv[5] || 'src/**/*.ts,src/**/*.js,tests/**/*.ts,tests/**/*.js,*.json'
  const patterns = patternsArg.split(',').map(p => p.trim())

  if (!dir || !outputFile) {
    console.error('Usage: snapshot.mjs snapshot <dir> <output.json> [patterns]')
    process.exit(1)
  }

  const files = globMatch(resolve(dir), patterns)
  const hashes = files.map(f => ({
    file: f,
    hash: fileHash(resolve(dir, f))
  }))

  const snapshot = {
    dir: resolve(dir),
    timestamp: new Date().toISOString(),
    fileCount: hashes.length,
    files: hashes
  }

  writeFileSync(resolve(outputFile), JSON.stringify(snapshot, null, 2) + '\n', 'utf-8')
  console.log(`[snapshot] ${hashes.length} files hashed -> ${outputFile}`)

} else if (mode === 'compare') {
  const beforeFile = process.argv[3]
  const afterFile = process.argv[4]

  if (!beforeFile || !afterFile) {
    console.error('Usage: snapshot.mjs compare <before.json> <after.json>')
    process.exit(1)
  }

  const before = JSON.parse(readFile(beforeFile))
  const after = JSON.parse(readFile(afterFile))

  const beforeMap = new Map(before.files.map(f => [f.file, f.hash]))
  const afterMap = new Map(after.files.map(f => [f.file, f.hash]))

  const changes = []

  // 检查修改的文件
  for (const [file, hash] of beforeMap) {
    const afterHash = afterMap.get(file)
    if (!afterHash) {
      changes.push({ file, type: 'deleted' })
    } else if (afterHash !== hash) {
      changes.push({ file, type: 'modified', beforeHash: hash, afterHash })
    }
  }

  // 检查新增的文件
  for (const [file, hash] of afterMap) {
    if (!beforeMap.has(file)) {
      changes.push({ file, type: 'added', hash })
    }
  }

  if (changes.length === 0) {
    console.log('[snapshot] OK: no changes detected')
    process.exit(0)
  } else {
    console.error(`[snapshot] FAIL: ${changes.length} file(s) changed:`)
    for (const c of changes) {
      console.error(`  ${c.type}: ${c.file}`)
    }
    // 输出 JSON 格式的变更详情
    const result = { changed: true, changeCount: changes.length, changes }
    writeFileSync(resolve(beforeFile).replace(/\.json$/, '-diff.json'), JSON.stringify(result, null, 2) + '\n', 'utf-8')
    process.exit(1)
  }

} else {
  console.error('Usage: snapshot.mjs snapshot|compare ...')
  process.exit(1)
}
