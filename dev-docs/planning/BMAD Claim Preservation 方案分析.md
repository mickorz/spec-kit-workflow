spec-kit-workflow 集成 BMAD Claim Preservation 方案分析
已核对远端最新代码
仓库：mickorz/spec-kit-workflow
当前 master：53fad49（EARS-P2）
一、核心结论：P2 已经实现了 Preservation 的基础设施
我查看了当前仓库的 sdd-feature.js、source-extraction.md、validate-source-map.mjs 和 EARS-P2 执行报告。
不建议重新实现 BMAD 的整套 Claim Preservation，而应该在现有 EARS-P2 上做增强。
因为你已经拥有三个非常关键的能力：
BMAD 的思想	现有实现	判断
提取来源关键陈述	Intake Agent + SRC-NNN	已有基础
保存原始来源	source-prd.md + SHA256	已实现
Claim → Spec 追踪	source-map.json	已实现
防止未映射的需求丢失	validate-source-map.mjs	已实现结构检查
防止 Spec 无依据新增	unsupported-requirement 检查	已实现结构检查
逐条验证语义是否保留	EARS Reviewer 有通用覆盖检查	尚缺独立的逐 Claim 保真验证
防止 Intake 自身漏提 Claim	主要依赖 Intake Prompt	尚缺独立审查
变更后的完整性与有效性保护	有 prdHash、Spec 基线机制	仍有增强空间
当前最重要的问题，不是你没有来源追踪，而是：
现有 Gate 可以证明「映射在结构上成立」，但不能证明「映射在语义上真实、完整且没有曲解」。
例如：
PRD:
背包已满时，如果有可堆叠格子，仍允许获取物品。

SRC-005:
背包满时允许继续堆叠。

Spec:
FR-003: 背包满时拒绝所有物品。

source-map.json:
SRC-005 → FR-003
disposition: covered


当前确定性 Gate 只会检查 FR-003 是否存在、映射是否合法、ID 是否正确；如果其他结构条件也满足，它不会识别 FR-003 和 SRC-005 的语义矛盾。
虽然现有 EARS 语义 Reviewer 可能发现问题，但并没有一份逐 SRC 的、独立且可复查的 Preservation 结果。
所以我建议将这次升级定位为 EARS-P3：Claim-level Semantic Preservation，而不是重新开发 PRD → Spec。
二、我在源码中发现的 7 个关键缺口
优先级	问题	当前风险
P0	Intake 提取遗漏没有独立校验	PRD 有 30 条需求，SRC 只提取 28 条，后续 Gate 仍可能全部通过
P0	映射真实性未验证	SRC-005 指向 FR-003，即使意思相反也可能通过
P0	acceptanceIds 可为空	Claim 的关键条件没有进入 AC，也能通过结构 Gate
P0	Source Coverage 修复后没有重跑 EARS 双门禁	修复 Spec 可能破坏此前已经通过的 EARS 质量结论
P1	pending 和 excluded 可以通过 Gate	关键需求可能在未澄清、未明确批准排除时进入开发
P1	审批基线没有冻结来源链	source-map.json 和 Preservation 结论不在审批基线检查范围
P2	当前审计只检查 Spec → Code	如果 Spec 本身漏掉 PRD 内容，sdd_audit 可能仍然通过
这里还有两个值得注意的源码细节。
首先，validate-source-map.mjs 虽然会验证 AC ID 的存在性和归属，但 covered 状态并不强制填写完整 acceptanceIds。假设 FR-003 有 AC-010、AC-011、AC-012，映射里只写 AC-010，现有 Source Coverage Gate 不会检查这个 Claim 的语义是否需要另外两条 AC。
其次，sdd-feature.js 中的 Source-Map-Fix 允许删除无来源依据的 Spec 需求，但修复之后只复检 Source Coverage，没有重新执行 EARS 格式和语义审查。这是可以优先修复的门禁顺序问题。
另外，EARS-P2 执行报告记录的确定性测试是 12/12 通过，但 Intake/Mapping 的 LLM 端到端链路尚未验证，所以现在还不能认为整个 PRD 防遗漏链路已经实测可靠。
三、推荐的最终架构
不改变原有 sdd_feature 主流程，只在两个关键位置增强检查。
原始 PRD / Goal


Intake Agent（已有）
生成 source-prd.md + SRC 声明台账


新增 Gate A：Intake Preservation
新增

独立阅读原始 PRD，判断是否存在未提取的关键 Claim


Specify + EARS 双门禁（已有）
生成 FR/NFR/AC，检查 EARS 格式和语义质量


Source Mapping + 结构 Gate（已有）
SRC → FR/NFR/AC 映射、ID 存在性和来源哈希检查


新增 Gate B：Semantic Preservation
核心新增

逐条对照 Claim 与 Spec：完整保留、部分遗漏、语义矛盾、无依据新增

不通过则修复并重新执行相关校验

Plan → Tasks → Analyze → Approval
批准后冻结 Spec、来源映射和审查结论


Implement → Review → Converge


这两个新增 Gate 的职责必须分开。
Gate A：原始 PRD → SRC
确保 Intake 没有漏提。它必须独立阅读原始 PRD，不能只检查已经提取的 SRC，因为 SRC 自身可能不完整。
Gate B：SRC → Spec
确保 SRC 中的关键语义确实进入 Spec，而不是仅仅挂了一个合法的 FR ID。
两个方向一起检查，才比较接近 BMAD 的 Claim-by-claim Preservation。
四、具体怎么修改项目？
1. 保留 source-map.json，增量扩展字段
不建议重新建立一份与 SRC 重复的 claims.json。
现有 source-map.json 已经有 sources 和 mappings，只需要在 sources 增加少量元数据。
例如：

{
  "sourceId": "SRC-005",
  "text": "背包满时有可堆叠格子仍允许获得物品",
  "status": "confirmed",
  "claimType": "exception",
  "loadBearing": true,
  "sourceRef": {
    "file": "source-prd.md",
    "lineStart": 42,
    "lineEnd": 44,
    "quote": "已有物品可以堆叠，则仍然允许获得"
  }
}



增加的字段各有作用：
字段	作用
claimType	区分功能、约束、例外、非目标、假设等
loadBearing	标识是否影响下游开发决策
sourceRef	保留来源位置和原文证据，便于独立复核
这里尤其要注意 sourceRef.quote。
它应该是原始 PRD 中确实存在的文字。可以由 Node 脚本校验引用位置与原文是否一致，而不应该只相信 Agent 填写的行号。
同时，不能只提取功能需求。否定性约束、非目标、关键数值和异常处理同样需要保留。
2. 新增独立 preservation-review.json
我建议不把语义 Reviewer 的结果塞进 source-map.json。
原因是两份文件的职责不同：
- source-map.json：说明声称建立了什么映射。
- preservation-review.json：说明这份映射是否可信、还有什么遗漏。
建议格式：

{
  "feature": "inventory",
  "verdict": "fix",
  "sourceHash": "sha256-...",
  "specHash": "sha256-...",
  "sourceMapHash": "sha256-...",
  "claims": [
    {
      "sourceId": "SRC-005",
      "requirementIds": ["FR-003"],
      "acceptanceIds": ["AC-010"],
      "status": "contradicted",
      "severity": "blocker",
      "sourceEvidence": "已有格子可以继续堆叠",
      "specEvidence": "背包满时拒绝所有物品",
      "finding": "Spec 丢失了允许继续堆叠的例外条件"
    }
  ],
  "intakeFindings": [],
  "unsupportedRequirements": []
}



关键是 claims 数组。
它必须覆盖 Source Ledger 中全部需要审核的 Claim ID，不能只返回 Reviewer 觉得有问题的几条。
否则 Reviewer 仍然可以通过遗漏审查对象来获得一个虚假的通过结果。
对于一条 SRC 被多个 FR/AC 共同实现的情况，Reviewer 要分析这些内容的组合语义，而不是要求一条 SRC 必须对应一条 FR。
我建议审查状态至少包括：
状态	解释	处理
preserved	完整保留原语义	通过
partial	保留了部分信息	修复
missing	没有找到有效承接	修复
contradicted	与原文相矛盾	修复
uncertain	证据不足，无法判断	人工澄清
excluded	有明确范围排除决策	核对排除依据
需要强调，preserved 是 Reviewer 基于证据作出的判断，确定性程序只能检查其证据、ID、结构和哈希是否合法，不能仅凭 JSON 证明语义判断正确。
3. 新增语义审核 Agent，复用 sdd_audit 的只读模式
你的项目已经有一个值得复用的模式。
在 sdd-audit.js 中，Reviewer 使用 agentType: 'explore' 只读审查，输出结果经宿主侧提取和持久化。
这个模式非常适合 Preservation 审核。
我不建议让生成 Spec 的同一个 Agent，直接给自己的工作打分，并且随意修改 preservation-review.json。
可以参照现有 extract-review.mjs 的做法，为 Preservation Reviewer 增加独立 JSON 提取工具，但不要直接复用其当前逻辑，因为它写死了 Audit-Reviewer 标签以及代码审核的 requirements 结构。
工作流中的伪代码可以是：

phase('Claim Preservation')

const review = await agent(
  preservationPrompt,
  {
    label: 'Claim-Preservation-Reviewer',
    agentType: 'explore',
    timeoutMs: 3600000
  }
)

await check(
  () => review !== null,
  'Preservation Reviewer 失败'
)

// 宿主从本次 Reviewer 的输出提取 JSON
await check(
  () => commandSuccess(
    `node sdd/tools/extract-preservation-review.mjs ${feature}`
  ),
  'Preservation 审查结果提取失败'
)

// 结构、引用、完整性、哈希和 verdict 门禁
await check(
  () => commandSuccess(
    `node sdd/tools/validate-preservation.mjs ${feature} --expect pass`
  ),
  'Claim Preservation 未通过'
)



以上是建议实现的接口示意，不是当前仓库已存在的工具。实际开发时应接入现有工作流 journal 的结果定位机制，避免读取其他 Run 的审查输出。校验器应当验证：
- Reviewer 是否审查了完整 SRC 集合。
- 每条审查是否有对应的合法映射。
- 来源引文和 Spec 证据是否真实存在。
- sourceHash、specHash、sourceMapHash 是否与当前文件一致。
- 是否存在未解决的 blocker。
- 是否出现未获批准的排除项或业务假设。
4. 修复循环需要保证校验结果不过期
这是现有 sdd-feature.js 最值得同步改进的部分。
建议任何 Agent 修改了 spec.md 之后，都重新执行：
validate-ears
    ↓
EARS Semantic Review
    ↓
validate-source-map
    ↓
Claim Preservation Review


不一定要每次完整重跑所有 Agent。可以根据本轮修改范围做增量审核，但最后进入 Plan 前必须保证四种检查都是针对同一版本的 Spec。
另外，当前的 checkpoint({ headless: 'approve' }) 不等价于真实业务澄清。对于没有确定答案的 Claim，应当记录明确的业务决定，而不是把简单的继续执行批准视为允许 Agent 猜测默认值。
五、建议的代码修改清单
修改位置	具体任务	优先级
sdd/rules/source-extraction.md	加入 Load-bearing Claim 判定、例外规则和来源引文要求	P0
sdd-feature.js	Intake 后增加独立的遗漏审查	P0
sdd/rules/claim-preservation.md	新增逐条语义保真审查规则	P0
sdd/tools/validate-preservation.mjs	新增 Preservation Review 结构与状态门禁	P0
sdd-feature.js	Source Coverage 后接入只读 Preservation Reviewer	P0
sdd-feature.js	修复 Spec 后重新执行失效的校验	P0
sdd/tools/validate-source-map.mjs	强化 AC 映射规则及 assumed/pending/excluded 处理	P1
sdd/tools/freeze-baseline.mjs、check-baseline.mjs	将来源、映射和保真结论纳入审批基线	P1
sdd-audit.js	有 PRD 时可选执行来源保真前置检查	P2
docs/ears-manual-testing.md	增加 Claim 级正向、反向和对抗测试	P0
六、必须解决的一个设计问题：不是所有 Claim 都是 FR
现有 source-map.json 对 covered 的要求是必须引用一个 FR/NFR。
但 BMAD 的 Claim Preservation 覆盖范围还包括：
- Non-goals：本次不做什么。
- Constraints：已有业务或技术约束。
- Assumptions：尚未验证的前提。
- Decisions：业务已经确认的取舍。
例如：
第一期不支持背包扩容。

它不一定应该变成一个功能需求，但也不能被随意丢掉。
所以 P1 阶段我建议增加类型化覆盖目标，使一个 Claim 可以映射到 FR、AC、Non-goal、Constraint 或 Companion，而不是强制把所有信息装进 FR/NFR。
同时继续保留旧的 requirementIds 字段，做渐进兼容。这样既不破坏当前的 Spec Parser，也能更完整地吸收 BMAD 的设计思想。
七、验收应该重点验证哪些真实缺陷？
现有 P2 的 S01～S12 测试保留不变。
新增测试应当模拟「结构看起来完全正确，但语义其实有问题」的情况。
测试	注入的错误	期望
P3-01	PRD 有 5 条 Claim，Intake 只提 4 条	Intake Preservation 拦截
P3-02	SRC 与 FR 的 ID 合法，但语义相反	Semantic Preservation 拦截
P3-03	原文堆叠上限 99，Spec 写成 999	拦截数值曲解
P3-04	丢失「除非可以继续堆叠」例外	拦截条件丢失
P3-05	原文禁止扩容，但 Spec 未记录此非目标	拦截非目标遗漏
P3-06	未经业务批准把关键 Claim 标记 excluded	阻止进入 Plan
P3-07	Spec 修复后未重新审核	拒绝过期 Review
P3-08	审批后修改 source-map	审批基线失效
P3-09	Agent 擅自添加未授权业务规则	反向审查拦截
建议特别做一次 A/B 测试。
使用同一份包含 30～50 条需求的游戏 PRD，一组使用当前 EARS-P2，一组使用新增 P3。由独立人工标注的 Claim 标准答案评估两组的关键需求遗漏率、错误排除率、语义矛盾检出率和误报率，同时记录 Token 成本与执行耗时。
因为加一个 Reviewer 不必然提升质量，必须通过这些对抗案例证明它确实补上了 P2 的盲区。
八、最终开发优先级

P0 — 逐条保真闭环
Intake 遗漏审核、独立 Semantic Preservation Reviewer、审查 JSON 契约、确定性验证器、修复后重新验证。
建议优先完成




P1 — 来源契约强化
非目标和约束的类型化映射、假设与排除审批、稳定 SRC ID、来源及审查结论的基线冻结。




P2 — 跨阶段延伸
将来源保真前置检查接入 sdd_audit，支持需求变更时的增量影响分析，并优化大 PRD 的分批审核成本。



我的最终建议：只增强已有 EARS-P2，不重新设计 PRD 转换链。
你现在已有：
PRD → SRC → FR/NFR/AC → Tasks → Code → Evidence
下一阶段最值得做的，是把 SRC → FR/NFR/AC 之间的「声明式映射」提升为「有证据的语义保真审查」，并补上 PRD → SRC 的独立遗漏检查。
这样既能完整保留之前 EARS-P0/P1/P2 的开发成果，又能让 spec-kit-workflow 真正具备一条更可信、可审计、可阻断的需求保真链。等这套机制在独立项目中验证稳定，再封装进 opencode-dynamicworkflows 的 sdd.* API，会比同时改造两个仓库更容易控制风险。