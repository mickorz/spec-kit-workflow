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

// 0. Intake：原始需求提取（EARS-P2：PRD → SRC 需求点，防遗漏的确定性基准）
phase('Intake')
const intake = await agent(
  `你是需求 Intake Agent。依据 sdd/rules/source-extraction.md 规则，从原始需求中逐条提取需求点。

原始需求：
${goal}

要求：
1. 先将原始需求原文逐字写入 ${dir}/source-prd.md（不得改写概括补充，如目录不存在请先创建）。
2. 提取每个可独立验证的需求点为 SRC-NNN（三位数字，按原文出现顺序），一条不漏。
3. 非功能要求（性能 安全 日志 合规）也必须提取。
4. status 只用 confirmed（原文明确）或 assumed（推断，text 中注明推断依据）。
5. 在 ${dir}/source-map.json 写入：

{
  "feature": "${feature}",
  "prdHash": "",
  "sources": [
    { "sourceId": "SRC-001", "text": "需求点原文或保守转述", "status": "confirmed" }
  ],
  "mappings": []
}

注意：prdHash 留空，由工具填充；mappings 留空数组，由后续 Mapping 阶段填写。
禁止调用 workflow 工具。`,
  { label: 'Intake', agentType: 'general', timeoutMs: 3600000 }
)
await check(() => intake !== null, 'Intake 失败')
await check(() => fileExists(`${dir}/source-prd.md`), 'source-prd.md 不存在')
await check(() => fileExists(`${dir}/source-map.json`), 'source-map.json 不存在')

// 冻结 prdHash（Intake 后原始需求不可再改写）
await check(
  () => commandSuccess(`node sdd/tools/freeze-source-map.mjs ${feature}`),
  'source-map prdHash 冻结失败'
)

// 1. Specify
phase('Specify')
const spec = await agent(
  `依据原始需求：${goal}

读取以下文件：
- sdd/templates/spec.md（新版 EARS Spec 模板）
- sdd/rules/ears-format.md（EARS 语法规则）

要求：
1. 使用 FR-NNN / NFR-NNN / AC-NNN 稳定 ID，三位数字，全局唯一不重复
2. 每个 FR 和 NFR 必须至少包含一条 AC
3. 所有 AC 必须使用 EARS 句式，触发关键字 When While If Where The shall 保留英文，变量部分用中文
4. 每条 AC 只描述一个主要行为，只允许出现一个 shall
5. AC 必须可观察可验证，禁止模糊词如 快速 稳定 安全
6. 不得擅自补充原始需求未提及的业务数值或规则
7. 无法确定的条件以 [待澄清: 原因] 标记，不得猜测
8. 覆盖正常流程、异常流程及边界条件
9. 逐条对照 ${dir}/source-map.json 的 sources，每个 SRC 都要有对应的 FR/NFR 或明确的范围决策，不得遗漏；不做的范围不要写入 Spec
10. 按模板结构在 ${dir}/ 目录下生成 spec.md（如目录不存在请先创建）

禁止调用 workflow 工具。`,
  { label: 'Specify', agentType: 'general', timeoutMs: 3600000 }
)
await check(() => spec !== null, 'Spec 生成失败')
await check(() => fileExists(`${dir}/spec.md`), 'Spec 文件不存在')

// 1.5 EARS 格式门禁（确定性，无 LLM；未通过则不进入 Plan）
await check(
  () => commandSuccess(`node sdd/tools/validate-ears.mjs ${feature}`),
  'EARS 格式校验失败，详见诊断输出'
)

// 1.6 EARS 语义门禁 + 有限修复循环（最多 2 轮；真歧义走人工澄清）
let earsPassed = false
for (let attempt = 1; attempt <= 2; attempt++) {
  const earsReviewPrompt = `你是独立的 EARS 语义 Reviewer。你的职责是在格式校验通过后，审查需求的语义质量。

读取以下文件：
1. ${dir}/spec.md —— 待审查的需求规格
2. sdd/rules/ears-format.md —— EARS 语法规则
3. sdd/rules/ears-semantic-review.md —— 语义审查规则（重点阅读）

原始需求（对照基准，判断是否有无依据新增）：
${goal}

审查要求：
- 先做机械检查：模糊词扫描（快速 稳定 安全 友好 合理 较好）、[待澄清] 标记扫描、重复 AC 检测。
- 再做语义判断：可测试性、歧义、单一行为、AC 间矛盾、WHAT HOW 混入、无依据业务规则、覆盖完整性。
- verdict 判定纪律：局部可修的问题给 fix；必须业务方决策的歧义给 clarify；禁止把歧义改成猜测。
- issue 的 target 必须是 spec 中真实存在的 AC-NNN / FR-NNN / NFR-NNN，整体问题用 "spec"。
- 有 blocker 时 verdict 不得为 pass；verdict 非 pass 时必须有 blocker。

在 ${dir}/ears-review.json 写入审查结论，格式：

{
  "feature": "${feature}",
  "verdict": "pass",
  "issues": [
    {
      "target": "AC-014",
      "type": "untestable",
      "severity": "blocker",
      "message": "具体问题描述"
    }
  ]
}

注意：
- verdict 枚举：pass fix clarify。
- type 枚举：untestable ambiguous multi-behavior contradicts duplicate implementation-detail unsupported-rule needs-clarification coverage-gap。
- severity 枚举：blocker warning。
- 无问题时 issues 为空数组。
- 只写 ears-review.json，不要修改其他文件。
禁止调用 workflow 工具。`

  const reviewer = await agent(earsReviewPrompt, {
    label: `EARS-Review-${attempt}`,
    agentType: 'general',
    timeoutMs: 3600000
  })
  await check(() => reviewer !== null, `EARS 语义审查第 ${attempt} 轮失败`)
  await check(() => fileExists(`${dir}/ears-review.json`), 'ears-review.json 不存在')

  // 确定性读取 verdict（三种期望都不匹配 = 结构非法）
  const anyValid = await commandSuccess(`node sdd/tools/ears-review-verdict.mjs ${feature} --expect pass`) ||
    await commandSuccess(`node sdd/tools/ears-review-verdict.mjs ${feature} --expect fix`) ||
    await commandSuccess(`node sdd/tools/ears-review-verdict.mjs ${feature} --expect clarify`)
  await check(() => anyValid, 'ears-review.json 结构非法（verdict 枚举 blocker 一致性 target 引用校验失败）')

  if (await commandSuccess(`node sdd/tools/ears-review-verdict.mjs ${feature} --expect pass`)) {
    log('EARS 双门禁通过（ears-pass）')
    earsPassed = true
    break
  }

  if (await commandSuccess(`node sdd/tools/ears-review-verdict.mjs ${feature} --expect clarify`)) {
    // 业务歧义：人工澄清，不猜测（semantic-clarify 状态）
    log(`EARS 审查状态：semantic-clarify（第 ${attempt} 轮，业务歧义待人工澄清）`)
    await checkpoint(
      `EARS 审查发现业务歧义，详见 ${dir}/ears-review.json 的 issues（type=needs-clarification 或 ambiguous）。\n请在澄清业务决策后批准继续，Agent 将按澄清结论修订 spec 并重新过两道门禁。`,
      { headless: 'approve' }
    )
    const reviser = await agent(
      `读取 ${dir}/spec.md 与 ${dir}/ears-review.json。人工已通过 checkpoint 批准继续（视为对 [待澄清] 标记与审查意见的确认）。
请修订 spec：
1. 将所有 [待澄清: 原因] 标记替换为保守、明确、可验证的表述；无法保守表述时删除该 AC 并在对应需求描述中说明限制。
2. 处理 ears-review.json 中 severity=blocker 的 issue。
3. 禁止新增任何原始需求与澄清意见之外的业务数值或规则。
4. 保持 FR NFR AC 的 ID 稳定，保持 EARS 句式。
重写 ${dir}/spec.md。
禁止调用 workflow 工具。`,
      { label: `EARS-Clarify-Revise-${attempt}`, agentType: 'general', timeoutMs: 3600000 }
    )
    await check(() => reviser !== null, '澄清修订失败')
  } else {
    // 局部问题：自动修复（semantic-fix 状态）
    log(`EARS 审查状态：semantic-fix（第 ${attempt} 轮自动修复）`)
    const fixer = await agent(
      `读取 ${dir}/spec.md 与 ${dir}/ears-review.json。你只负责修复 ears-review.json 中 severity=blocker 的 issue：
1. 只修改 issue 涉及的 AC 或需求，禁止重写无关内容。
2. 禁止为解决歧义而凭空添加业务默认值。
3. 无法在问题层面解决时，把对应 AC 改标 [待澄清: 原因]（下一轮审查将触发 clarify 路径）。
4. 修复后保持 FR NFR AC 的 ID 稳定，保持 EARS 句式。
重写 ${dir}/spec.md。
禁止调用 workflow 工具。`,
      { label: `EARS-Fix-${attempt}`, agentType: 'general', timeoutMs: 3600000 }
    )
    await check(() => fixer !== null, `EARS 修复第 ${attempt} 轮失败`)
  }

  // 修复或澄清修订后，必须重新通过确定性格式门禁（防修复引入格式同题）
  await check(
    () => commandSuccess(`node sdd/tools/validate-ears.mjs ${feature}`),
    'EARS 修复后格式校验失败（format-error）'
  )
}
await check(() => earsPassed, 'EARS 语义门禁两轮未通过，流程终止（真歧义应走人工澄清路径）')

// 1.7 Source Coverage Gate（EARS-P2：PRD → Spec 来源追踪与防遗漏，确定性）
phase('Source Coverage')
const mappingPrompt = `你是 Source Mapping Agent。依据 sdd/rules/source-extraction.md 的 disposition 规则，填写原始需求到 Spec 的映射。

读取以下文件：
1. ${dir}/source-map.json —— 原始需求清单（sources 已由 Intake 提取，mappings 待你填写）
2. ${dir}/spec.md —— 已通过 EARS 双门禁的需求规格

要求：
1. 为每个 SRC 填写恰好一条 mapping：
   - covered：已转换为 Spec 需求，requirementIds 必填真实存在，acceptanceIds 填对应 AC。
   - excluded：明确不做，必须给 note 理由，不允许静默丢失。
   - pending：待业务澄清，必须给 note；禁止用 excluded 吞掉不确定项。
2. Spec 中每个 FR 和 NFR 都应能追溯到至少一个 SRC；无法追溯的属于无依据新增，不要为其编造映射。
3. 不确定的用 pending，不要猜测。
4. 只更新 source-map.json 的 mappings 数组，不动 sources 与 prdHash。
5. 重写 ${dir}/source-map.json。
禁止调用 workflow 工具。`

const mapper = await agent(mappingPrompt, {
  label: 'Source-Mapping',
  agentType: 'general',
  timeoutMs: 3600000
})
await check(() => mapper !== null, 'Source Mapping 失败')

let sourceCoveragePassed = false
for (let attempt = 1; attempt <= 2; attempt++) {
  if (await commandSuccess(`node sdd/tools/validate-source-map.mjs ${feature}`)) {
    log('Source Coverage Gate 通过（原始需求全部有处置结果，Spec 无无依据新增）')
    sourceCoveragePassed = true
    break
  }

  if (attempt === 1) {
    log('Source Coverage 校验失败，按诊断修复（source-map-fix）')
    const fixer = await agent(
      `运行 node sdd/tools/validate-source-map.mjs ${feature} 查看诊断输出。
依据诊断修复问题：
- mapping 缺失或 disposition 错误 → 修正 ${dir}/source-map.json 的 mappings。
- unsupported-requirement（Spec 需求无 SRC 依据）→ 若确属必要新增，从 spec.md 中删除该需求；若它是某条 SRC 的合理细化，把映射补到对应 SRC。
- unknown-id 或 ownership → 修正引用。
- prd-hash → 仅当 source-prd.md 未被人为改写时，运行 node sdd/tools/freeze-source-map.mjs ${feature}。
禁止调用 workflow 工具。`,
      { label: 'Source-Map-Fix', agentType: 'general', timeoutMs: 3600000 }
    )
    await check(() => fixer !== null, 'Source Map 修复失败')
  }
}
await check(() => sourceCoveragePassed, 'Source Coverage Gate 修复一轮后仍未通过，流程终止（PRD 需求未被完整处置）')

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
      "acceptanceIds": ["AC-006"],
      "verificationMethod": "manual"
    }
  ]
}

注意：
- specHash 留空字符串，由工具自动填充。
- 每个 FR 和 NFR 必须有任务映射，不能遗漏任何需求。
- FR 和 NFR 的 acceptanceIds 都不允许为空，必须列出对应需求的全部 AC。
- acceptanceIds 中的 AC 必须归属对应的 requirementId。
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
      "evidenceRefs": ["AC-003"],
      "verifications": [
        { "ac": "AC-003", "type": "static_check", "testId": null, "result": "passed", "reason": "bcrypt cost factor 10 在 BcryptHasher 中确认", "fileRef": "src/services/bcrypt-hasher.ts:15" }
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
- FR 与 NFR 一致：verifications 必须覆盖该需求的全部 AC，每个 AC 都必须有 verification 条目，禁止 ac 为 null。
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
