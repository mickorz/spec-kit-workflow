#!/usr/bin/env node
// collect-results.mjs — 汇总所有实验运行结果
// 用法: node experiments/collect-results.mjs

import { readdirSync, readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const resultsDir = resolve('experiments', 'results')
const summaryFile = resolve(resultsDir, 'summary.json')

if (!existsSync(resultsDir)) {
  console.error('results 目录不存在')
  process.exit(1)
}

const files = readdirSync(resultsDir).filter(f => f.endsWith('.json') && f !== 'summary.json')
const runs = []

for (const f of files) {
  try {
    const data = JSON.parse(readFileSync(resolve(resultsDir, f), 'utf-8').replace(/^\uFEFF/, ''))
    runs.push(data)
  } catch {}
}

// 按组分类
const groups = { A0: [], A1: [], B: [] }
for (const run of runs) {
  if (groups[run.group]) groups[run.group].push(run)
}

// 计算每组统计
const summary = {
  timestamp: new Date().toISOString(),
  totalRuns: runs.length,
  groups: {}
}

for (const [group, groupRuns] of Object.entries(groups)) {
  if (groupRuns.length === 0) continue

  const acceptanceRates = groupRuns.map(r => r.hiddenAcceptance?.passRate || 0)
  const missedReqs = groupRuns.map(r => r.hiddenAcceptance?.failed || 0)

  // B 组额外统计错误收敛
  let falseConvergence = null
  if (group === 'B') {
    const converged = groupRuns.filter(r => r.internalConverged === true)
    const falseConverged = converged.filter(r => r.hiddenAcceptance?.failed > 0)
    falseConvergence = {
      internalConverged: converged.length,
      falseConverged: falseConverged.length,
      rate: converged.length > 0 ? (falseConverged.length / converged.length) : null
    }
  }

  summary.groups[group] = {
    runs: groupRuns.length,
    acceptanceRate: {
      mean: acceptanceRates.reduce((a, b) => a + b, 0) / acceptanceRates.length,
      values: acceptanceRates
    },
    avgMissedRequirements: missedReqs.reduce((a, b) => a + b, 0) / missedReqs.length,
    missedValues: missedReqs,
    falseConvergence,
    runIds: groupRuns.map(r => r.runId)
  }
}

writeFileSync(summaryFile, JSON.stringify(summary, null, 2) + '\n', 'utf-8')

// 输出汇总表
console.log('=== A/B 实验汇总 ===\n')
console.log('| 指标 | A0 | A1 | B |')
console.log('|------|----|----|---|')

const metrics = [
  ['运行次数', 'runs'],
  ['平均隐藏验收通过率', 'acceptanceRate.mean'],
  ['平均遗漏需求数', 'avgMissedRequirements'],
]

for (const [label, key] of metrics) {
  const vals = ['A0', 'A1', 'B'].map(g => {
    const grp = summary.groups[g]
    if (!grp) return '—'
    if (key === 'acceptanceRate.mean') return (grp.acceptanceRate.mean * 100).toFixed(0) + '%'
    if (key === 'runs') return grp.runs
    if (key === 'avgMissedRequirements') return grp.avgMissedRequirements.toFixed(1)
    return '—'
  })
  console.log(`| ${label} | ${vals[0]} | ${vals[1]} | ${vals[2]} |`)
}

// B 组错误收敛
if (summary.groups.B?.falseConvergence) {
  const fc = summary.groups.B.falseConvergence
  console.log(`\nB 组错误收敛: ${fc.falseConverged}/${fc.internalConverged}${fc.rate !== null ? ` (rate: ${(fc.rate * 100).toFixed(0)}%)` : ' (N/A)'}`)
}

console.log(`\n汇总已保存: ${summaryFile}`)
