export const meta = {
  name: 'experiment_a1',
  description: 'A/B 实验 A1：Spec → Coding → 自测 → 自修复'
}

const runDir = args.runDir
const specFile = args.specFile || `${runDir}/spec.md`
const appDir = `${runDir}/app`
const maxRounds = 3

await check(() => typeof runDir === 'string' && runDir.length > 0, '需要 runDir 参数')

// A1：Coding + 自测 + 自修复（无 Reviewer，无 Coverage Gate）
let converged = false
for (let round = 1; round <= maxRounds; round++) {
  phase(`Round ${round}`)

  let prompt = `读取 ${specFile}（需求规格）。`
  if (round === 1) {
    prompt += `
在 ${appDir}/src/auth.ts 中实现 spec 末尾"公共 API 契约"定义的全部接口。
在 ${appDir}/tests/ 目录下编写你自己的单元测试。
实现所有 FR 和 NFR。审计日志必须包含来源 IP。密码必须使用带盐慢哈希。`
  } else {
    prompt += `
读取 ${appDir}/tests/ 下的测试文件和上一轮测试结果。
修复测试失败的代码。确保所有测试通过。`
  }
  prompt += `\n禁止调用 workflow 工具。`

  const impl = await agent(prompt, {
    label: `A1-R${round}`,
    agentType: 'general',
    timeoutMs: 3600000
  })
  await check(() => impl !== null, `Round ${round} 失败`)

  // 自测
  const testOk = await commandSuccess(
    `cd /d ${appDir} && npx vitest run`,
    300000
  )
  log(`Round ${round} 测试${testOk ? '通过' : '失败'}`)

  if (testOk) {
    converged = true
    break
  }

  if (round < maxRounds) {
    log(`Round ${round} 未通过，进入下一轮修复`)
  } else {
    log(`达到最大轮次 ${maxRounds}，仍未通过`)
  }
}

return { runDir, appDir, converged, rounds: converged ? 1 : maxRounds, output: `A1 ${converged ? '通过' : '未通过'}` }
