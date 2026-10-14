export const meta = {
  name: 'sdd_feature',
  description: 'Spec Kit 风格的规格驱动开发流程（含 Reviewer 语义审查）'
}

const feature = args.feature
const goal = args.goal
const maxRounds = args.maxRounds || 3
const skipRequirement = args.skipRequirement || null

// 输入校验
await check(
  () => typeof feature === 'string' &&
    /^[a-z0-9-]+$/.test(feature) &&
    typeof goal === 'string' &&
    goal.trim().length > 0,
  '需要合法的 feature 和 goal'
)

const dir = `specs/${feature}`
const appDir = `fixtures/${feature}-app`

// === 阶段一：规格驱动 ===

// 1. Specify
phase('Specify')
const spec = await agent(
  `依据需求：${goal}
参照 sdd/templates/spec.md 格式。
在 ${dir}/ 目录下生成 spec.md（如目录不存在请先创建）。
使用 FR-001、AC-001、NFR-001 等稳定 ID，三位数字，不重复。
每个 FR 必须有至少一个 AC（验收条件）。
如有非功能需求，使用 NFR-NNN 编号。
覆盖正常流程、异常流程及边界条件。
禁止调用 workflow 工具。`,
  { label: 'Specify', agentType: 'general', timeoutMs: 3600000 }
)
await check(() => spec !== null, 'Spec 生成失败')
await check(() => fileExists(`${dir}/spec.md`), 'Spec 文件不存在')

// 2. Plan
phase('Plan')
const plan = await agent(
  `读取 ${dir}/spec.md，参照 sdd/templates/plan.md 格式。
生成 ${dir}/plan.md。
为每个 FR 和 NFR 设计实现方案。
禁止调用 workflow 工具。`,
  { label: 'Plan', agentType: 'general', timeoutMs: 3600000 }
)
await check(() => plan !== null, 'Plan 失败')
await check(() => fileExists(`${dir}/plan.md`), 'plan.md 不存在')

// 3. Tasks
phase('Tasks')
const tasks = await agent(
  `读取 ${dir}/spec.md 和 ${dir}/plan.md。
参照 sdd/templates/tasks.md 格式。
生成两个文件：

1. ${dir}/tasks.md：任务清单，每个任务用 T-001 等三位数字 ID。
2. ${dir}/traceability.json：需求映射，格式如下：

{
  "feature": "${feature}",
  "specHash": "",
  "mappings": [
    {
      "requirementId": "FR-001",
      "taskId": "T-001",
      "acceptanceIds": ["AC-001"],
      "verificationMethod": "test"
    },
    {
      "requirementId": "NFR-001",
      "taskId": "T-005",
      "acceptanceIds": [],
      "verificationMethod": "manual"
    }
  ]
}

注意：
- specHash 留空字符串，由工具自动填充。
- 每个 FR 和 NFR 必须有任务映射，不能遗漏任何需求。
- NFR 的 acceptanceIds 可为空数组。
- NFR 的 verificationMethod 可为 "manual" 或 "test"。
- taskId 必须在 tasks.md 中存在。
- verificationMethod 只允许 "test" 或 "manual"。
禁止调用 workflow 工具。`,
  { label: 'Tasks', agentType: 'general', timeoutMs: 3600000 }
)
await check(() => tasks !== null, 'Tasks 失败')
await check(() => fileExists(`${dir}/tasks.md`), 'tasks.md 不存在')
await check(() => fileExists(`${dir}/traceability.json`), 'traceability.json 不存在')

// 4. Analyze
phase('Analyze')
await check(
  () => commandSuccess(`node sdd/tools/freeze-traceability.mjs ${feature}`),
  'specHash 冻结失败'
)
await check(
  () => commandSuccess(`node sdd/tools/coverage.mjs ${feature}`),
  'Spec -> Tasks 覆盖率未达标'
)

// 5. 人工审批
await checkpoint(
  '需求、技术计划和任务已生成且通过覆盖率检查（含 NFR），批准进入编码？',
  { headless: 'approve' }
)

// 6. 冻结审批基线
await check(
  () => commandSuccess(`node sdd/tools/freeze-baseline.mjs ${feature}`),
  '审批基线冻结失败'
)

// === 阶段二：Implement -> Test -> Review -> Converge 循环 ===

let converged = false
let finalRound = 0

for (let round = 1; round <= maxRounds; round++) {
  finalRound = round

  // === Implement ===
  phase(`Round ${round}: Implement`)

  await check(
    () => commandSuccess(`node sdd/tools/check-baseline.mjs ${feature}`, 30000),
    '审批基线校验失败（spec 或 traceability 被修改）'
  )

  let implPrompt = `读取 ${dir}/spec.md、${dir}/plan.md、${dir}/tasks.md。`
  if (round === 1) {
    implPrompt += `
这是第一轮实现。在 ${appDir}/ 目录下：
1. 根据任务清单实现源码（TypeScript）。
2. 编写测试代码（放在 ${appDir}/tests/ 目录下）。
3. 如需测试框架，安装依赖并更新 package.json 的 test 脚本。
4. 将已完成的任务在 tasks.md 中标记 Status 为 done。`
  } else {
    implPrompt += `
读取 ${dir}/evidence.json（上一轮测试结果）和 ${dir}/findings.json（修复任务）。
这是第 ${round} 轮修复。在 ${appDir}/ 目录下：
1. 根据 findings.json 中的缺口项修复代码或补充实现。
2. 区分三类缺口：
   - requirement_gap：需求遗漏，必须实现对应功能。
   - test_failure：测试失败，修复代码使测试通过。
   - test_infrastructure：测试工具问题，调整测试命令或配置。
3. 将修复任务在 tasks.md 中标记 Status 为 done。`
  }

  // 决定性测试：故意跳过指定需求
  if (skipRequirement && round === 1) {
    implPrompt += `\n\n重要：故意不实现 ${skipRequirement} 的功能。不要写相关代码，不要写相关测试。这是用于验证 Reviewer 能否独立发现需求遗漏的测试。`
  }

  implPrompt += `\n禁止调用 workflow 工具。`

  const impl = await agent(implPrompt, {
    label: `Implement-R${round}`,
    agentType: 'general',
    timeoutMs: 3600000
  })
  await check(() => impl !== null, `Round ${round} Implement 失败`)

  // === Test ===
  phase(`Round ${round}: Test`)
  const testOk = await commandSuccess(
    `node sdd/tools/run-tests.mjs ${feature} ${round}`,
    600000
  )
  log(`Test Runner 执行${testOk ? '成功' : '出错'}`)
  await check(() => testOk, 'Test Runner 脚本自身异常')
  await check(() => fileExists(`${dir}/evidence.json`), 'evidence.json 不存在')

  // === Review ===
  phase(`Round ${round}: Review`)
  const reviewPrompt = `你是独立的 Reviewer Agent。你的职责是审查代码是否真正实现了 Spec 中的每条需求。

读取以下文件：
1. ${dir}/spec.md —— 需求规格（批准后的真相源）
2. ${dir}/evidence.json —— 测试结果（含 testResults 逐测试详情）
3. ${appDir}/src/ 目录下的所有源码文件
4. ${appDir}/tests/ 目录下的所有测试文件

审查要求：
- 必须逐条检查 spec.md 中的每个 FR 和 NFR。
- 不要信任 tasks.md 中的 done 标记或 Implement Agent 的总结。
- 必须阅读真实代码，判断每条需求是否被正确实现。
- 必须检查测试是否覆盖了每条需求的验收条件（AC）。
- 对于每个 AC，必须在 verifications 中填写验证方式：
  - automated_test：必须提供 testId（测试名称），该 testId 必须在 evidence.json 的 testResults 中存在。
  - static_check：必须提供 reason 和 fileRef（指向具体文件:行号，如 src/services/bcrypt-hasher.ts:15）。
  - manual：必须提供 reason 和 approver（审批人标识，如 "code-reviewer-zhang"）。无审批人则标记 unverified。
- 没有充分证据的 AC 应标记为 unverified，不能默认 pass。

审查状态枚举：
- pass：需求已正确实现，每个 AC 有验证证据。
- partial：部分实现，有缺口（说明缺了什么）。
- missing：完全未实现（代码中找不到相关逻辑）。
- contradicts：实现与 Spec 矛盾（说明矛盾点）。
- unverified：代码看起来正确，但没有充分的测试证据。

在 ${dir}/review.json 写入审查结果，格式如下：

{
  "feature": "${feature}",
  "round": ${round},
  "specHash": "",
  "reviewerLabel": "Reviewer-R${round}",
  "requirements": [
    {
      "id": "FR-001",
      "status": "pass",
      "evidenceRefs": ["AC-001", "AC-002"],
      "verifications": [
        { "ac": "AC-001", "type": "automated_test", "testId": "login success returns token", "result": "passed" },
        { "ac": "AC-002", "type": "automated_test", "testId": "login wrong password fails", "result": "passed" }
      ],
      "finding": null
    },
    {
      "id": "NFR-001",
      "status": "pass",
      "evidenceRefs": [],
      "verifications": [
        { "ac": null, "type": "static_check", "testId": null, "result": "passed", "reason": "bcrypt cost factor 10 在 BcryptHasher 中确认" }
      ],
      "finding": null
    },
    {
      "id": "FR-003",
      "status": "missing",
      "evidenceRefs": ["AC-009"],
      "verifications": [],
      "finding": "代码中未找到锁定机制相关实现"
    }
  ]
}

注意：
- requirements 数组必须包含 spec.md 中的所有 FR 和 NFR，不能遗漏。
- status 非 pass 时 finding 必须非空。
- status=pass 时每个 AC 必须有对应的 verification 条目。
- automated_test 的 testId 必须是 evidence.json testResults 中真实存在的测试名称。
- static_check 必须包含 fileRef（文件:行号引用）。
- manual 必须包含 approver（审批人标识）。
- specHash 留空字符串，由工具填充。
- 只写 review.json，不要修改其他文件。
禁止调用 workflow 工具。`

  const review = await agent(reviewPrompt, {
    label: `Review-R${round}`,
    agentType: 'general',
    timeoutMs: 3600000
  })
  await check(() => review !== null, `Round ${round} Review 失败`)
  await check(() => fileExists(`${dir}/review.json`), 'review.json 不存在')

  // 填充 review.json 的 specHash
  await check(
    () => commandSuccess(`node sdd/tools/freeze-review.mjs ${feature}`, 30000),
    'review.json specHash 填充失败'
  )

  // 独立校验 review.json 结构完整性（ID/specHash/AC 覆盖/状态枚举）
  await check(
    () => commandSuccess(`node sdd/tools/validate-review.mjs ${feature} ${round}`, 30000),
    'review.json 结构校验失败（ID 不完整或 specHash 不匹配）'
  )

  // === Converge ===
  phase(`Round ${round}: Converge`)
  const isConverged = await commandSuccess(
    `node sdd/tools/is-converged.mjs ${feature} ${round}`,
    30000
  )

  if (isConverged) {
    log(`Round ${round} 已收敛（全部 7 项条件通过）`)
    converged = true
    break
  }

  log(`Round ${round} 未收敛`)

  if (round < maxRounds) {
    await check(
      () => commandSuccess(`node sdd/tools/append-findings.mjs ${feature} ${round}`, 30000),
      'append-findings 失败'
    )
    log(`Round ${round} 修复任务已追加，进入下一轮`)
  } else {
    log(`已达到最大轮次 ${maxRounds}，仍未收敛`)
  }
}

// === 输出 ===
const status = converged ? 'converged' : 'not-converged'
log(`流程结束：${status}（round ${finalRound}）`)

return {
  feature,
  dir,
  converged,
  rounds: finalRound,
  status,
  output: `${feature} ${status}（经过 ${finalRound} 轮）`
}
