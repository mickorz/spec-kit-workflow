export const meta = {
  name: 'sdd_feature',
  description: 'Spec Kit 风格的规格驱动开发流程（含 Reviewer 语义审查）'
}

const feature = args.feature
const goal = args.goal || ''
const maxRounds = args.maxRounds || 3
const skipRequirement = args.skipRequirement || null
const prdPath = typeof args.prdPath === 'string' ? args.prdPath.trim() : ''
const largeMode = prdPath.length > 0
const MAX_CHUNKS = 200

// 输入校验：feature 合法 + goal 与 prdPath 至少其一（prdPath 为大文档模式）
await check(
  () => typeof feature === 'string' &&
    /^[a-z0-9-]+$/.test(feature) &&
    ((typeof goal === 'string' && goal.trim().length > 0) || largeMode),
  '需要合法的 feature，且 goal 与 prdPath 至少提供其一'
)

const dir = `specs/${feature}`
const appDir = `fixtures/${feature}-app`

// === 阶段一：规格驱动 ===

// 0. Intake：原始需求提取（EARS-P2：PRD → SRC 需求点，防遗漏的确定性基准）
phase('Intake')
if (largeMode) {
  // === 大文档模式（LPRD）：切块 → 分块提取 → 合并 → 容量门禁 → Chunk Gate A ===
  // 任何阶段都不把整份 PRD 拼进 Prompt

  // 0.1 切块与完整性校验（确定性）
  await check(
    () => commandSuccess(`node sdd/tools/prd-chunker.mjs ${feature} --from "${prdPath}" --force`),
    'PRD 切块失败'
  )
  await check(
    () => commandSuccess(`node sdd/tools/validate-chunks.mjs ${feature}`),
    'Chunk 结构校验失败（原文覆盖或切片不一致，禁止静默截断）'
  )

  // 0.2 分块提取局部 Claim（每块独立 Agent，任一块失败不得跳过，有限重试）
  for (let ci = 1; ci <= MAX_CHUNKS; ci++) {
    const chunkId = `CHUNK-${String(ci).padStart(3, '0')}`
    const chunkExists = await commandSuccess(`node sdd/tools/validate-chunks.mjs ${feature} --exists ${chunkId}`)
    if (!chunkExists) break
    // 断点续跑（幂等）：已有通过校验的 claims 则跳过该块提取（重跑不重提）
    if (await commandSuccess(`node sdd/tools/validate-claims.mjs ${feature} ${chunkId}`)) {
      log(`${chunkId} claims 已存在且校验通过，跳过（断点续跑）`)
      continue
    }
    let extracted = false
    for (let attempt = 1; attempt <= 2 && !extracted; attempt++) {
      const extractor = await agent(
        `你是 Chunk Intake Agent（${chunkId}）。依据 sdd/rules/large-prd-intake.md 第二节契约提取本块需求点。

读取 ${dir}/intake/chunks/${chunkId}.md（注意：文件可能带 overlap 前缀行，主内容以中后部为准；行号一律按整个文件从 1 计数）。

要求：
1. 每个可独立验证的需求点一条 Claim，localId 用 L-NNN（块内从 001 起）。
2. claimType 六枚举（functional constraint exception non-goal assumption decision）、loadBearing 布尔；非功能 否定性约束 例外 关键数值不漏；纯背景章节可为空数组。
3. lineStart lineEnd 用 Chunk 文件内相对行号，quote 逐字来自本文件且落在该区间（有确定性校验，不匹配会重试）。
4. 在 ${dir}/intake/claims/${chunkId}.json 写入 {"chunkId":"${chunkId}","claims":[...]}。
禁止调用 workflow 工具。`,
        { label: `Chunk-Intake-${chunkId}${attempt > 1 ? '-R' + attempt : ''}`, agentType: 'general', timeoutMs: 3600000 }
      )
      await check(() => extractor !== null, `${chunkId} 提取第 ${attempt} 轮失败`)
      if (await commandSuccess(`node sdd/tools/validate-claims.mjs ${feature} ${chunkId}`)) {
        extracted = true
      }
    }
    await check(() => extracted, `${chunkId} 块提取两轮失败（任一块失败不得跳过）`)
  }
  log('全部 Chunk 提取完成')

  // 0.3 语义合并（Merge Agent + 确定性归并；冲突只登记不选边，人工裁决后重并）
  let merged = false
  for (let round = 1; round <= 2 && !merged; round++) {
    const merger = await agent(
      `你是 Claim Merge Agent。读取 ${dir}/intake/claims/ 目录下全部 CHUNK-*.json（紧凑 JSON，量小）。
${round > 1 ? `若存在 ${dir}/intake/conflict-decisions.md，按其中人工裁决处理对应冲突（解决后纳入正常合并，从 conflicts 移除）。` : ''}
依据 sdd/rules/large-prd-intake.md 合并纪律，在 ${dir}/intake/semantic.json 写入：

{"duplicateGroups":[{"kept":"L-001@CHUNK-001","merged":["L-003@CHUNK-002"],"reason":"语义相同"}],"conflicts":[{"claims":["L-002@CHUNK-001","L-001@CHUNK-003"],"description":"跨章节矛盾描述","status":"unresolved"}]}

纪律：语义相同才合并并给 reason；跨章节冲突只登记 status=unresolved，禁止选边猜测；没有则空数组。
禁止调用 workflow 工具。`,
      { label: `Claim-Merge${round > 1 ? '-R' + round : ''}`, agentType: 'general', timeoutMs: 3600000 }
    )
    await check(() => merger !== null, `Claim Merge 第 ${round} 轮失败`)

    if (await commandSuccess(`node sdd/tools/merge-claims.mjs ${feature} --semantic ${dir}/intake/semantic.json --expect ok`)) {
      merged = true
      log('Claim 合并完成：无未解决冲突')
    } else if (await commandSuccess(`node sdd/tools/merge-claims.mjs ${feature} --semantic ${dir}/intake/semantic.json --expect conflict`)) {
      log('Claim 合并存在未解决冲突（large-prd-conflict），等待人工裁决')
      await checkpoint(
        `跨章节 Claim 冲突待裁决，详见 ${dir}/intake/merge-report.json 的 conflicts。\n请将裁决（每个冲突采用哪个值或如何取舍）写入 ${dir}/intake/conflict-decisions.md 后批准继续，Agent 将按裁决重出语义报告。`,
        { headless: 'approve' }
      )
    }
  }
  await check(() => merged, 'Claim 合并两轮未通过（冲突未解决），流程终止')

  // 0.4 prdHash 冻结 + 容量门禁（超限明确阻断，保留中间产物）
  await check(
    () => commandSuccess(`node sdd/tools/freeze-source-map.mjs ${feature}`),
    'source-map prdHash 冻结失败'
  )
  await check(
    () => commandSuccess(`node sdd/tools/check-capacity.mjs ${feature}`),
    '容量门禁未通过（Claim 清单或 Chunk 规模超限；intake/ 中间产物已保留，请拆分为多个 Feature 或调整 config largePrd 阈值后重跑，禁止截断继续）'
  )

  // 0.5 Chunk Gate A：逐块只读漏提审查（explore）+ 聚合 + 补漏重聚
  for (let ci = 1; ci <= MAX_CHUNKS; ci++) {
    const chunkId = `CHUNK-${String(ci).padStart(3, '0')}`
    const chunkExists = await commandSuccess(`node sdd/tools/validate-chunks.mjs ${feature} --exists ${chunkId}`)
    if (!chunkExists) break
    // 断点续跑（幂等）：已有通过校验的审查结果则跳过该块（重跑不重提）
    if (
      (await commandSuccess(`node sdd/tools/validate-chunk-review.mjs ${feature} ${chunkId} --expect pass`)) ||
      (await commandSuccess(`node sdd/tools/validate-chunk-review.mjs ${feature} ${chunkId} --expect fix`))
    ) {
      log(`${chunkId} 审查已存在且结构合法，跳过（断点续跑）`)
      continue
    }
    const reviewer = await agent(
      `你是 Chunk Gate A Reviewer（只读，${chunkId}）。依据 sdd/rules/large-prd-intake.md 第三节纪律审查本块提取完整性。

你是只读 Reviewer，不能修改任何文件。你的回复必须只包含一个 JSON 对象，不要 markdown 围栏，不要任何解释。

独立重读 ${dir}/intake/chunks/${chunkId}.md 全文（注意开头可能有 overlap 前缀行，遗漏只认主区间内容），对照 ${dir}/intake/claims/${chunkId}.json 已提取的 Claim：
- 每条明确要求（功能 约束 例外 非目标 关键数值 异常处理）都应有对应 Claim；发现未提取的记入 missedClaims。
- missedClaims 每条：quote（本块逐字引文）lineStart lineEnd（Chunk 文件内相对行号且落在主区间）suggestedClaimType（六枚举）reason。
- verdict：pass（无遗漏）或 fix（存在遗漏）。

你的回复必须是以下 JSON 格式（纯 JSON）：

{"chunkId":"${chunkId}","verdict":"pass","missedClaims":[]}`,
      { label: `Chunk-GateA-${chunkId}`, agentType: 'explore', timeoutMs: 3600000 }
    )
    await check(() => reviewer !== null, `${chunkId} Gate A 审查失败`)
    await check(
      () => commandSuccess(`node sdd/tools/extract-agent-json.mjs --label Chunk-GateA-${chunkId} --agentType explore --out ${dir}/intake/reviews/${chunkId}.json`),
      `${chunkId} 审查结果提取失败`
    )
    await check(
      () => commandSuccess(`node sdd/tools/validate-chunk-review.mjs ${feature} ${chunkId} --expect pass`) ||
            commandSuccess(`node sdd/tools/validate-chunk-review.mjs ${feature} ${chunkId} --expect fix`),
      `${chunkId} 审查结构非法`
    )
  }

  let intakePreserved = false
  for (let round = 1; round <= 2 && !intakePreserved; round++) {
    if (await commandSuccess(`node sdd/tools/aggregate-intake-review.mjs ${feature} --expect pass`)) {
      intakePreserved = true
      log('Chunk Gate A 聚合通过：全部块无未解决遗漏')
      break
    }
    if (round === 1) {
      log('Chunk Gate A 存在未解决遗漏，补漏（large-gate-a-fix）')
      const fixer = await agent(
        `读取 ${dir}/intake-review.json（聚合遗漏清单，含 chunkId 与绝对行号）与 ${dir}/source-map.json。
把每条 missedClaims 补为新 SRC（按现有最大 SRC 编号递增，不改已有）：
- sourceRef 用给出的绝对行号与 quote；claimType 用 suggestedClaimType；loadBearing 默认 true；status 用 confirmed。
- 同时把该 Claim 追加到对应 ${dir}/intake/claims/CHUNK-*.json（localId 按块内最大递增；行号换算为该块 Chunk 文件内相对行号 = 绝对行号 - 块文件起点 + 1，块文件起点见 manifest 的 overlapStart 或 lineStart）。
只追加不修改已有内容，不动 prdHash。
禁止调用 workflow 工具。`,
        { label: 'Large-GateA-Fix', agentType: 'general', timeoutMs: 3600000 }
      )
      await check(() => fixer !== null, 'Chunk Gate A 补漏失败')
      await check(
        () => commandSuccess(`node sdd/tools/validate-claims.mjs ${feature}`),
        '补漏后块级 Claim 校验失败'
      )
    }
  }
  await check(() => intakePreserved, 'Chunk Gate A 两轮未通过：PRD 关键 Claim 存在未处理遗漏，流程终止（Specify 不启动）')

  // 0.6 处理状态与成本统计落盘（诊断，不阻断）
  await commandSuccess(`node sdd/tools/run-report.mjs ${feature}`)
} else {
  // === 短需求模式：单个 Intake Agent + 整篇 Gate A（EARS-P2/P3 原有链路） ===
  const intake = await agent(
    `你是需求 Intake Agent。依据 sdd/rules/source-extraction.md 规则，从原始需求中逐条提取需求点。

原始需求：
${goal}

要求：
1. 先将原始需求原文逐字写入 ${dir}/source-prd.md（不得改写概括补充，如目录不存在请先创建）。
2. 提取每个可独立验证的需求点为 SRC-NNN（三位数字，按原文出现顺序），一条不漏。
3. 非功能要求（性能 安全 日志 合规）、否定性约束（不做什么）、例外条件、关键数值也必须提取。
4. status 只用 confirmed（原文明确）或 assumed（推断，text 中注明推断依据）。
5. 每个 SRC 必须携带 Claim 元数据：claimType（functional constraint exception non-goal assumption decision 六枚举）、loadBearing（是否影响下游开发决策，布尔）、sourceRef（file 固定 source-prd.md，lineStart lineEnd 为原文行号，quote 为原文逐字引文，行号区间内必须包含该引文）。
6. 在 ${dir}/source-map.json 写入：

{
  "feature": "${feature}",
  "prdHash": "",
  "sources": [
    {
      "sourceId": "SRC-001",
      "text": "需求点原文或保守转述",
      "status": "confirmed",
      "claimType": "functional",
      "loadBearing": true,
      "sourceRef": { "file": "source-prd.md", "lineStart": 1, "lineEnd": 1, "quote": "原文逐字引文" }
    }
  ],
  "mappings": []
}

注意：prdHash 留空，由工具填充；mappings 留空数组，由后续 Mapping 阶段填写。
后续会有独立 Gate 重读原文比对遗漏，并确定性校验引文与行号一致性。
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

// 0.5 Gate A：Intake Preservation（独立遗漏审查，explore 只读；两轮内补齐遗漏，否则 Specify 不启动）
let intakePreserved = false
for (let attempt = 1; attempt <= 2 && !intakePreserved; attempt++) {
  const intakeReviewPrompt = `你是 Intake Preservation Reviewer（只读）。依据 sdd/rules/claim-preservation.md 第一节纪律，独立审查 PRD 到 SRC 的提取完整性。

你是只读 Reviewer，不能修改任何文件。你的回复必须只包含一个 JSON 对象，不要用 markdown 围栏，不要任何解释。

独立通读以下文件（不得预设已有 SRC 是完整的）：
1. ${dir}/source-prd.md —— 原始需求原文
2. ${dir}/source-map.json —— 已提取的 SRC 台账

审查要求：
- 逐段核对原文：每一条明确要求（功能 约束 例外 非目标 关键数值 异常处理）都应有对应 SRC。
- 发现未提取的关键陈述记入 missedClaims：quote（原文逐字引文）lineStart lineEnd（行号）suggestedClaimType（六枚举）reason（为什么是关键 Claim）。
- verdict：pass（无遗漏，missedClaims 空数组）或 fix（存在遗漏）。没有 clarify，漏了就补。

你的回复必须是以下 JSON 格式（纯 JSON）：

{"feature":"${feature}","verdict":"pass","prdHash":"","missedClaims":[]}`

  const reviewerA = await agent(intakeReviewPrompt, {
    label: 'Intake-Preservation-Reviewer',
    agentType: 'explore',
    timeoutMs: 3600000
  })
  await check(() => reviewerA !== null, `Gate A 第 ${attempt} 轮审查失败`)
  await check(
    () => commandSuccess(`node sdd/tools/extract-agent-json.mjs --label Intake-Preservation-Reviewer --agentType explore --out ${dir}/intake-review.json`),
    'intake-review.json 提取失败'
  )

  if (await commandSuccess(`node sdd/tools/validate-intake-review.mjs ${feature} --expect pass`)) {
    log('Gate A 通过：Intake 无关键遗漏')
    intakePreserved = true
    break
  }

  if (attempt < 2) {
    const gateAFix = await commandSuccess(`node sdd/tools/validate-intake-review.mjs ${feature} --expect fix`)
    if (gateAFix) {
      log(`Gate A：发现漏提 Claim，补充 sources（gate-a-fix 第 ${attempt} 轮）`)
      const fixerA = await agent(
        `读取 ${dir}/intake-review.json 与 ${dir}/source-map.json。
把 missedClaims 逐条追加为新 SRC（按现有最大编号递增，不改已有 SRC）：
- claimType 用 suggestedClaimType，loadBearing 默认 true。
- sourceRef 的 lineStart lineEnd quote 直接用 missedClaims 提供的行号与引文。
- status 用 confirmed。
只追加 sources，不动 mappings 与 prdHash，重写 ${dir}/source-map.json。
禁止调用 workflow 工具。`,
        { label: `Gate-A-Fix-${attempt}`, agentType: 'general', timeoutMs: 3600000 }
      )
      await check(() => fixerA !== null, 'Gate A 补充遗漏失败')
    }
    // 结构非法时不修复，直接由下一轮重审拿到新鲜输出
  }
}
await check(() => intakePreserved, 'Gate A 两轮未通过：PRD 关键 Claim 存在未处理遗漏，流程终止（Specify 不启动）')
} // 结束短需求模式分支

// 1. Specify（大文档模式读 source-map 清单，不拼整份 PRD；短模式读 goal）
phase('Specify')
const demandHeader = largeMode
  ? `原始需求以 ${dir}/source-map.json 的 sources 为准（大文档模式：逐条 SRC 逐条对照，禁止遗漏；需要上下文时按 sourceRef 行号读 ${dir}/intake/chunks/ 对应片段，不要读 source-prd.md 全文）${goal ? '\n补充说明：' + goal : ''}`
  : `依据原始需求：\n${goal}`
const spec = await agent(
  `${demandHeader}

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
- ac-required（关键条件未进 AC）→ 在 spec.md 对应需求下补 EARS 句式的 AC 并补进 acceptanceIds。
- quote-mismatch → 修正 sourceRef 的行号或 quote 为原文真实内容。
- prd-hash → 仅当 source-prd.md 未被人为改写时，运行 node sdd/tools/freeze-source-map.mjs ${feature}。
禁止调用 workflow 工具。`,
      { label: 'Source-Map-Fix', agentType: 'general', timeoutMs: 3600000 }
    )
    await check(() => fixer !== null, 'Source Map 修复失败')

    // 重跑链（EARS-P3）：修复可能改了 spec.md，必须重过 EARS 格式门禁与语义审查，
    // 否则此前通过的 EARS 质量结论针对的是旧版 Spec（失效校验）
    await check(
      () => commandSuccess(`node sdd/tools/validate-ears.mjs ${feature}`),
      'Source Map 修复后 EARS 格式校验失败（format-error）'
    )
    const earsRecheck = await agent(
      `你是独立的 EARS 语义 Reviewer（重跑链）。上一轮门禁后 spec.md 被修复 Agent 修改过，需要重新审查。
读取 ${dir}/spec.md、sdd/rules/ears-format.md、sdd/rules/ears-semantic-review.md。
按语义审查规则出结论，在 ${dir}/ears-review.json 写入（verdict pass fix clarify + issues，与既往格式一致）。
禁止调用 workflow 工具。`,
      { label: 'EARS-Review-Rerun', agentType: 'general', timeoutMs: 3600000 }
    )
    await check(() => earsRecheck !== null, '重跑链 EARS 语义审查失败')
    await check(
      () => commandSuccess(`node sdd/tools/ears-review-verdict.mjs ${feature} --expect pass`),
      '重跑链 EARS 语义审查未通过（spec 修复引入了语义问题，需人工介入）'
    )
  }
}
await check(() => sourceCoveragePassed, 'Source Coverage Gate 修复一轮后仍未通过，流程终止（PRD 需求未被完整处置）')

// 1.8 Gate B：Claim Preservation（SRC 到 Spec 语义保真，explore 只读 + 确定性哈希门禁）
phase('Claim Preservation')
let preservationPassed = false
for (let attempt = 1; attempt <= 2 && !preservationPassed; attempt++) {
  const preservationPrompt = `你是 Claim Preservation Reviewer（只读）。依据 sdd/rules/claim-preservation.md 第二节纪律，逐条核对原始需求 Claim 与 Spec 的语义保真。

你是只读 Reviewer，不能修改任何文件。你的回复必须只包含一个 JSON 对象，不要用 markdown 围栏，不要任何解释。

读取以下文件：
${largeMode
  ? `1. ${dir}/source-map.json —— SRC 台账（每条含 sourceRef 绝对行号与逐字 quote 与 chunkId）
2. ${dir}/intake/chunks/ 目录 —— 按 chunkId 与行号定位对应片段作为原文证据（大文档模式：不读 source-prd.md 全文）
3. ${dir}/spec.md —— 需求规格
4. sdd/rules/claim-preservation.md —— 审查规则（重点）`
  : `1. ${dir}/source-prd.md —— 原始需求原文
2. ${dir}/source-map.json —— SRC 台账与映射
3. ${dir}/spec.md —— 需求规格
4. sdd/rules/claim-preservation.md —— 审查规则（重点）`}

审查要求：
- claims 数组必须覆盖 source-map 的全部 SRC，一条不漏（缺失即校验失败）。
- 六状态枚举：preserved partial missing contradicted uncertain excluded；组合语义分析（一条 SRC 可由多个 FR AC 共同实现）。
- 非 preserved 必须给 sourceEvidence（原文引文）与 finding；partial 和 contradicted 还必须给 specEvidence（Spec 原文引文）。
- 数值敏感性：原文 99 写成 999 是 contradicted 或 partial，不是大体保留。
- 例外敏感性：丢失除非可以继续堆叠类例外条件是 partial，即使主行为已实现。
- excluded 状态需核对 source-map 中该 SRC 的 disposition 是否为 excluded 且有 note。
- unsupportedRequirements：spec 中无法追溯到任何 SRC 的 FR NFR ID 列表。
- severity：非 preserved 默认 blocker；verdict：pass 无 blocker / fix 可修复 / clarify 存在 uncertain 需业务决策。有 blocker 时 verdict 不得为 pass。

你的回复必须是以下 JSON 格式（纯 JSON，三个哈希留空字符串）：

{"feature":"${feature}","verdict":"pass","prdHash":"","specHash":"","sourceMapHash":"","claims":[{"sourceId":"SRC-001","requirementIds":["FR-001"],"acceptanceIds":["AC-001"],"status":"preserved","severity":"warning","sourceEvidence":null,"specEvidence":null,"finding":null}],"intakeFindings":[],"unsupportedRequirements":[]}`

  const reviewerB = await agent(preservationPrompt, {
    label: 'Claim-Preservation-Reviewer',
    agentType: 'explore',
    timeoutMs: 3600000
  })
  await check(() => reviewerB !== null, `Gate B 第 ${attempt} 轮审查失败`)
  await check(
    () => commandSuccess(`node sdd/tools/extract-agent-json.mjs --label Claim-Preservation-Reviewer --agentType explore --out ${dir}/preservation-review.json`),
    'preservation-review.json 提取失败'
  )
  await check(
    () => commandSuccess(`node sdd/tools/freeze-preservation.mjs ${feature}`),
    'preservation 哈希冻结失败'
  )

  if (await commandSuccess(`node sdd/tools/validate-preservation.mjs ${feature} --expect pass`)) {
    log('Gate B 通过：全部 Claim 语义保真，无过期审查')
    preservationPassed = true
    break
  }

  if (attempt < 2) {
    if (await commandSuccess(`node sdd/tools/validate-preservation.mjs ${feature} --expect clarify`)) {
      log('Gate B：preservation-clarify（存在 uncertain Claim，等待人工澄清）')
      await checkpoint(
        `Claim 保真审查发现无法判定的 Claim（详见 ${dir}/preservation-review.json 中 status=uncertain 的条目）。\n请在澄清业务决策后批准继续，Agent 将按澄清结论修订并重新走保真审查。`,
        { headless: 'approve' }
      )
      const reviserB = await agent(
        `读取 ${dir}/preservation-review.json 与 ${dir}/spec.md。人工已通过 checkpoint 批准继续（视为对 uncertain Claim 的确认）。
依据 claims 中 status=uncertain 条目的 sourceEvidence 与 finding，把保守明确的实现写入 spec.md（保持 EARS 句式与既有 ID 稳定，禁止新增未确认业务数值）。
禁止调用 workflow 工具。`,
        { label: `Preservation-Clarify-${attempt}`, agentType: 'general', timeoutMs: 3600000 }
      )
      await check(() => reviserB !== null, 'Gate B 澄清修订失败')
    } else {
      log(`Gate B：preservation-fix（第 ${attempt} 轮修复）`)
      const fixerB = await agent(
        `运行 node sdd/tools/validate-preservation.mjs ${feature} 查看诊断输出，并读取 ${dir}/preservation-review.json 的 claims。
依据 finding 修复：
- partial 或 missing → 修 spec.md：补齐丢失的条件 数值 例外（EARS 句式，ID 稳定），必要时同步补 source-map 的映射。
- contradicted → 修 spec.md 中与原文矛盾的表述。
- missing-claim（某 SRC 未被审查）不修复，由下一轮重审覆盖。
- 修复只针对 finding 涉及内容，禁止重写无关内容。
禁止调用 workflow 工具。`,
        { label: `Preservation-Fix-${attempt}`, agentType: 'general', timeoutMs: 3600000 }
      )
      await check(() => fixerB !== null, `Gate B 修复第 ${attempt} 轮失败`)
    }

    // 重跑链（EARS-P3）：spec 或 source-map 被修改后，四类检查必须重新针对同一版本成立
    await check(
      () => commandSuccess(`node sdd/tools/validate-ears.mjs ${feature}`),
      'Gate B 修复后 EARS 格式校验失败（format-error）'
    )
    const earsRecheckB = await agent(
      `你是独立的 EARS 语义 Reviewer（重跑链）。上一轮门禁后 spec.md 被修改过，需要重新审查。
读取 ${dir}/spec.md、sdd/rules/ears-format.md、sdd/rules/ears-semantic-review.md。
按语义审查规则出结论，在 ${dir}/ears-review.json 写入（verdict pass fix clarify + issues，与既往格式一致）。
禁止调用 workflow 工具。`,
      { label: `EARS-Review-Rerun-B${attempt}`, agentType: 'general', timeoutMs: 3600000 }
    )
    await check(() => earsRecheckB !== null, '重跑链 EARS 语义审查失败')
    await check(
      () => commandSuccess(`node sdd/tools/ears-review-verdict.mjs ${feature} --expect pass`),
      '重跑链 EARS 语义审查未通过（需人工介入）'
    )
    await check(
      () => commandSuccess(`node sdd/tools/validate-source-map.mjs ${feature}`),
      'Gate B 修复后 Source Coverage 校验失败（映射与 Spec 不一致）'
    )
    // Gate B 本体由循环下一轮重审（fresh 哈希）
  }
}
await check(() => preservationPassed, 'Gate B 两轮未通过：Claim 语义保真未达成，流程终止（Plan 不启动）')

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
