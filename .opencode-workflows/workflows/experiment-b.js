export const meta = {
  name: 'experiment_b',
  description: 'A/B 实验 B：SDD Workflow（从冻结 Spec 开始，跳过 Specify）'
}

const feature = args.feature || 'experiment'
const runDir = args.runDir
const specFile = args.specFile || `${runDir}/spec.md`
const appDir = `${runDir}/app`
const maxRounds = args.maxRounds || 3

await check(() => typeof runDir === 'string' && runDir.length > 0, '需要 runDir 参数')

const dir = `specs/${feature}`

// === 准备阶段：复制冻结 Spec 到 SDD 工作目录 ===
// 工作流工具脚本使用 specs/<feature>/ 路径，需要先设置目录
await check(
  () => commandSuccess(`if not exist "${dir}" mkdir "${dir}"`, 5000),
  '创建 spec 目录失败'
)
await check(
  () => commandSuccess(`copy /Y "${specFile}" "${dir}\\spec.md"`, 5000),
  '复制冻结 Spec 失败'
)

// === Plan ===
phase('Plan')
const plan = await agent(
  `读取 ${dir}/spec.md，参照 sdd/templates/plan.md 格式。
生成 ${dir}/plan.md。
为每个 FR 和 NFR 设计实现方案。
禁止调用 workflow 工具。`,
  { label: 'B-Plan', agentType: 'general', timeoutMs: 3600000 }
)
await check(() => plan !== null, 'Plan 失败')
await check(() => fileExists(`${dir}/plan.md`), 'plan.md 不存在')

// === Tasks ===
phase('Tasks')
const tasks = await agent(
  `读取 ${dir}/spec.md 和 ${dir}/plan.md。
参照 sdd/templates/tasks.md 格式。
生成两个文件：
1. ${dir}/tasks.md：任务清单，T-NNN 三位数字。
2. ${dir}/traceability.json：需求映射，specHash 留空。
每个 FR 和 NFR 必须有任务映射。
禁止调用 workflow 工具。`,
  { label: 'B-Tasks', agentType: 'general', timeoutMs: 3600000 }
)
await check(() => tasks !== null, 'Tasks 失败')
await check(() => fileExists(`${dir}/tasks.md`), 'tasks.md 不存在')
await check(() => fileExists(`${dir}/traceability.json`), 'traceability.json 不存在')

// === Analyze ===
phase('Analyze')
await check(
  () => commandSuccess(`node sdd/tools/freeze-traceability.mjs ${feature}`),
  'specHash 冻结失败'
)
await check(
  () => commandSuccess(`node sdd/tools/coverage.mjs ${feature}`),
  '覆盖率未达标'
)
await check(
  () => commandSuccess(`node sdd/tools/freeze-baseline.mjs ${feature}`),
  '审批基线冻结失败'
)

// === Implement → Test → Review → Converge 循环 ===
let converged = false
let finalRound = 0

for (let round = 1; round <= maxRounds; round++) {
  finalRound = round
  phase(`Round ${round}: Implement`)

  await check(
    () => commandSuccess(`node sdd/tools/check-baseline.mjs ${feature}`, 30000),
    '审批基线校验失败'
  )

  let implPrompt = `读取 ${dir}/spec.md、${dir}/plan.md、${dir}/tasks.md。`
  if (round === 1) {
    implPrompt += `
第一轮实现。在 ${appDir}/src/auth.ts 中实现 spec 末尾"公共 API 契约"定义的全部接口。
在 ${appDir}/tests/ 下编写测试代码。
确保 package.json 的 test 脚本可用。
将已完成任务在 tasks.md 中标记 Status 为 done。`
  } else {
    implPrompt += `
读取 ${dir}/evidence.json 和 ${dir}/findings.json。
根据缺口项修复代码。将修复任务标记 done。`
  }
  implPrompt += `\n禁止调用 workflow 工具。`

  const impl = await agent(implPrompt, {
    label: `B-Implement-R${round}`,
    agentType: 'general',
    timeoutMs: 3600000
  })
  await check(() => impl !== null, `Round ${round} Implement 失败`)

  // Test
  phase(`Round ${round}: Test`)
  const testOk = await commandSuccess(
    `node sdd/tools/run-tests.mjs ${feature} ${round}`,
    600000
  )
  await check(() => testOk, 'Test Runner 异常')
  await check(() => fileExists(`${dir}/evidence.json`), 'evidence.json 不存在')

  // Review
  phase(`Round ${round}: Review`)
  const reviewPrompt = `你是独立的 Reviewer Agent。审查代码是否真正实现了 Spec 中的每条需求。

读取以下文件：
1. ${dir}/spec.md —— 需求规格
2. ${dir}/evidence.json —— 测试结果（含 testResults）
3. ${appDir}/src/ 目录下所有源码
4. ${appDir}/tests/ 目录下所有测试

审查要求：
- 逐条检查每个 FR 和 NFR。
- 不要信任 tasks.md 的 done 标记。
- 必须阅读真实代码。
- 每个 AC 必须在 verifications 中填写验证方式：
  - automated_test：testId 必须在 evidence.json testResults 中存在。
  - static_check：必须含 fileRef（文件:行号）。
  - manual：必须含 approver。
- 无充分证据的 AC 标记 unverified。

在 ${dir}/review.json 写入审查结果。specHash 留空。只写 review.json。禁止调用 workflow 工具。`

  const review = await agent(reviewPrompt, {
    label: `B-Review-R${round}`,
    agentType: 'general',
    timeoutMs: 3600000
  })
  await check(() => review !== null, `Round ${round} Review 失败`)
  await check(() => fileExists(`${dir}/review.json`), 'review.json 不存在')

  await check(
    () => commandSuccess(`node sdd/tools/freeze-review.mjs ${feature}`, 30000),
    'review.json specHash 填充失败'
  )
  await check(
    () => commandSuccess(`node sdd/tools/validate-review.mjs ${feature} ${round}`, 30000),
    'review.json 结构校验失败'
  )

  // Converge
  phase(`Round ${round}: Converge`)
  const isConverged = await commandSuccess(
    `node sdd/tools/is-converged.mjs ${feature} ${round}`,
    30000
  )

  if (isConverged) {
    log(`Round ${round} 已收敛`)
    converged = true
    break
  }

  log(`Round ${round} 未收敛`)
  if (round < maxRounds) {
    await check(
      () => commandSuccess(`node sdd/tools/append-findings.mjs ${feature} ${round}`, 30000),
      'append-findings 失败'
    )
    log(`Round ${round} 修复任务已追加`)
  } else {
    log(`达到最大轮次 ${maxRounds}，仍未收敛`)
  }
}

return {
  runDir,
  appDir,
  converged,
  rounds: finalRound,
  internalConverged: converged,
  output: `B ${converged ? 'converged' : 'not-converged'}（${finalRound} 轮）`
}
