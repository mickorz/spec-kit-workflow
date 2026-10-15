# EARS 语义质量审查规则（ears-semantic-review）

> 本规则供 EARS 语义 Reviewer Agent 使用，在确定性格式校验（validate-ears.mjs）通过后执行。
> 参考：cc-sdd requirements-review-gate.md 本地化改造。
> 结论写入 `specs/<feature>/ears-review.json`，由 `ears-review-verdict.mjs` 确定性读取。

## 一、审查维度

| 维度 | 检查内容 | issue type |
|------|---------|-----------|
| 可测试性 | 行为是否可观察、可验证；是否含模糊词（快速、稳定、安全、友好、合理、较好） | untestable |
| 单一行为 | 一条 AC 是否隐性混合多个行为（格式层已拦双 shall，语义层查"一个 shall 里塞两件事"） | multi-behavior |
| 歧义 | 条件或行为是否有多重解读 | ambiguous |
| 一致性 | AC 之间是否重复或矛盾 | duplicate / contradicts |
| WHAT/HOW | 是否把技术实现（数据库、框架、API 形态、类名）混入需求 | implementation-detail |
| 无依据新增 | 是否擅自补充原始需求未提及的业务数值或规则 | unsupported-rule |
| 待澄清标记 | 是否存在 [待澄清: 原因] 标记（存在即走澄清路径，不自动放行） | needs-clarification |
| 覆盖完整性 | 核心用户流程、主要异常、可见边界条件是否覆盖 | coverage-gap |

## 二、verdict 判定规则

- `pass`：无 blocker 级 issue（warning 级允许存在，记录但不阻断）。
- `fix`：存在可在 Spec 局部修复的 blocker（改写措辞、拆分 AC、补齐边界），不涉及业务决策。
- `clarify`：存在必须业务方决策的歧义（原始需求未定义的行为、互相矛盾的期望、[待澄清] 标记）。

判定纪律：

1. 先跑机械检查（模糊词扫描、[待澄清] 扫描、重复 AC 检测），再做语义判断。
2. 局部问题给 fix，真业务歧义给 clarify——**禁止把歧义改成猜测**。
3. 修复循环上限两轮，仍不通过则终止工作流（真歧义应已走 clarify 由人工处理）。

## 三、issue 结构

```json
{
  "target": "AC-014",
  "type": "untestable",
  "severity": "blocker",
  "message": "响应时间不超过合理范围 中 合理 未定义可验证标准"
}
```

- `target`：AC-NNN / FR-NNN / NFR-NNN / `spec`（整体问题）。
- `type` 枚举：untestable / ambiguous / multi-behavior / contradicts / duplicate / implementation-detail / unsupported-rule / needs-clarification / coverage-gap。
- `severity` 枚举：blocker（必须处理）、warning（记录不阻断）。
- 有 blocker 时 verdict 不得为 pass（由 ears-review-verdict.mjs 强制校验）。

## 四、与格式门禁的分工

- 格式门禁（validate-ears.mjs）：句式、ID、结构——确定性，失败即终止。
- 语义门禁（本规则）：含义、质量、覆盖——LLM 判断，结论经确定性读取器解析。
- 两道门禁都在 Plan 之前；修复后必须重新通过两道门禁。
