# Claim Preservation 审查规则（claim-preservation）

> 本规则供两个只读 Preservation Reviewer 使用：
> 1. Gate A（Intake Preservation）：审 PRD → SRC 是否漏提，产出 `specs/<feature>/intake-review.json`
> 2. Gate B（Claim Preservation）：审 SRC → Spec 语义是否保真，产出 `specs/<feature>/preservation-review.json`
> 确定性校验：`validate-intake-review.mjs` 与 `validate-preservation.mjs`（只验结构、证据、哈希与完整性，不判断语义对错）。

## 一、Gate A：Intake 遗漏审查纪律

1. **独立重读原文**：必须独立通读 source-prd.md 全文，对照 source-map.json 的 sources 逐段核对；不得预设"已有 SRC 是完整的"——SRC 自身可能漏提。
2. **遗漏判定**：原文中每一条明确要求（功能、约束、例外、非目标、关键数值、异常处理）都应有对应 SRC；发现未提取的关键陈述记入 missedClaims。
3. missedClaims 每条必须给：quote（原文逐字引文）、lineStart/lineEnd（行号）、suggestedClaimType（六枚举）、reason（为什么这是关键 Claim）。
4. verdict：`pass`（无遗漏，missedClaims 为空）/ `fix`（存在遗漏）。没有 clarify——漏了就补，不是业务歧义。
5. 输出纯 JSON，无 markdown 围栏，无多余解释。

## 二、Gate B：逐条保真审查纪律

1. **逐条全覆盖**：claims 数组必须覆盖 source-map 的全部 SRC，一条不漏。只返回"有问题的几条"是违规行为——缺失即校验失败。
2. **六状态枚举**：

| 状态 | 含义 | 证据要求 | 处置 |
|------|------|---------|------|
| preserved | 完整保留原语义 | 无强制 | 通过 |
| partial | 保留部分信息（丢条件、丢数值、丢例外） | sourceEvidence + specEvidence + finding | 修复 |
| missing | 无有效承接 | sourceEvidence + finding | 修复 |
| contradicted | 与原文语义矛盾 | sourceEvidence + specEvidence + finding | 修复 |
| uncertain | 证据不足无法判断 | sourceEvidence + finding | 人工澄清 |
| excluded | 有明确范围排除决策 | sourceEvidence + finding | 核对 source-map 的 disposition=excluded 与 note |

3. **组合语义**：一条 SRC 可由多个 FR/AC 共同实现，分析组合语义，不强制一对一。
4. **证据可复核**：sourceEvidence 是 source-prd.md 原文引文；specEvidence 是 spec.md 原文引文；finding 说明丢失/矛盾/不足的具体内容。
5. **数值敏感性**：原文 99 写成 999 属 contradicted 或 partial（数值曲解），不是"大体保留"。
6. **例外敏感性**：丢失"除非可以继续堆叠"类例外条件属 partial（条件丢失），即使主行为已实现。
7. **unsupportedRequirements**：spec 中无法追溯到任何 SRC 的 FR/NFR ID 列表（语义级确认，与 validate-source-map 的结构级反向检查互补）。
8. **intakeFindings**：复制 Gate A 遗留未解决的发现（通常为空）。
9. verdict 判定：`pass`（无 blocker）/ `fix`（存在可修复的 partial/missing/contradicted）/ `clarify`（存在 uncertain 且需业务决策）。有 blocker 时 verdict 不得为 pass。
10. severity：blocker（partial/missing/contradicted/uncertain 默认）/ warning（存疑但不阻断）。
11. 三个哈希（prdHash/specHash/sourceMapHash）留空字符串，由宿主工具冻结——Review 结论必须锚定被审文件的当前版本。
12. 输出纯 JSON，无 markdown 围栏，无多余解释。

## 三、与既有门禁的分工

| 门禁 | 方向 | 性质 |
|------|------|------|
| validate-source-map | SRC → Spec 结构（ID/归属/哈希/处置枚举） | 确定性 |
| Gate A（本规则一） | PRD → SRC 完整性 | LLM 只读审查 + 确定性校验 |
| Gate B（本规则二） | SRC → Spec 语义保真 | LLM 只读审查 + 确定性校验 |
| EARS 语义门禁（P1） | Spec 内部质量（可测试性/歧义/句式） | LLM + 确定性 |

四道门禁全部通过才能进入 Plan；preserved 判断是 LLM 结论，确定性工具只保证其证据、结构、覆盖与哈希可信。
