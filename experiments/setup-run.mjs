#!/usr/bin/env node
// setup-run.mjs — 准备单个实验运行目录
// 用法: node experiments/setup-run.mjs <group> <trial>
// 例如: node experiments/setup-run.mjs A0 01

import { cpSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { execSync } from 'node:child_process'

const rootDir = process.cwd()
const group = process.argv[2]
const trial = process.argv[3]

if (!group || !trial) {
  console.error('Usage: node experiments/setup-run.mjs <group> <trial>')
  console.error('  group: A0 | A1 | B')
  console.error('  trial: 01 | 02 | 03')
  process.exit(1)
}

const runId = `${group}-${trial}`
const runDir = resolve('experiments', 'runs', runId)
const fixturesDir = resolve('experiments', 'fixtures')
const initialProject = resolve(fixturesDir, 'initial-project')
const frozenSpec = resolve(fixturesDir, 'frozen-spec.md')

// 清理旧目录
if (existsSync(runDir)) {
  import('node:fs').then(fs => fs.rmSync(runDir, { recursive: true, force: true }))
}

// 创建目录结构
mkdirSync(runDir, { recursive: true })
mkdirSync(resolve(runDir, 'app'), { recursive: true })

// 复制初始项目
cpSync(initialProject, resolve(runDir, 'app'), { recursive: true })

// 复制冻结 Spec
cpSync(frozenSpec, resolve(runDir, 'spec.md'))

// 安装依赖
console.log(`[${runId}] 安装依赖...`)
try {
  execSync('npm install', {
    cwd: resolve(runDir, 'app'),
    encoding: 'utf-8',
    timeout: 120000,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  })
  console.log(`[${runId}] 依赖安装完成`)
} catch (e) {
  console.error(`[${runId}] 依赖安装失败: ${e.message}`)
  process.exit(1)
}

// 对于 B 组，额外设置 SDD 工具目录
if (group === 'B') {
  const feature = `experiment-${runId}`
  const sddSpecDir = resolve('specs', feature)
  mkdirSync(sddSpecDir, { recursive: true })
  cpSync(frozenSpec, resolve(sddSpecDir, 'spec.md'))

  // 更新 config.json
  const configPath = resolve('sdd', 'config.json')
  let config = {}
  try {
    config = JSON.parse(readFileSync(configPath, 'utf-8').replace(/^\uFEFF/, ''))
  } catch {}
  config.features = config.features || {}
  config.features[feature] = {
    appDir: `${runDir}/app`,
    buildCommand: 'npx tsc --noEmit',
    testCommand: 'npx vitest run',
    sourceGlobs: ['src/**/*.ts'],
    testGlobs: ['tests/**/*.ts'],
    timeoutMs: 300000
  }
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
  console.log(`[${runId}] SDD config 已更新 (feature=${feature})`)
}

console.log(`[${runId}] 目录准备完成: ${runDir}`)
console.log(`[${runId}] App: ${resolve(runDir, 'app')}`)
console.log(`[${runId}] Spec: ${resolve(runDir, 'spec.md')}`)

if (group === 'B') {
  console.log(`[${runId}] SDD feature: experiment-${runId}`)
}

// 输出 JSON 供脚本使用
console.log(JSON.stringify({
  runId,
  runDir,
  appDir: resolve(runDir, 'app'),
  specFile: resolve(runDir, 'spec.md'),
  group,
  feature: group === 'B' ? `experiment-${runId}` : undefined
}))
