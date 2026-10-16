# SDD 工作流文档（sdd-feature）

> 本文档用 mermaid 记录 `.opencode-workflows/workflows/sdd-feature.js` 的完整流程。
> 维护规则见 `CLAUDE.md`：工作流脚本变更时必须同步更新本文档的图与阶段说明。
> 术语见 `docs/glossary.md`；Artifact 契约见 `dev-docs/design/sdd-artifact-contract.md`。

## 一、总流程

需求保真阶段（Plan 之前）保证 PRD → Spec 无遗漏、无曲解；实现收敛阶段按轮循环直至七项收敛条件全部满足。

```mermaid
flowchart TD
    subgraph SG1 [需求保真阶段 Plan 之前]
        A[原始 PRD 或 goal 输入] --> B[Intake Agent 提取 SRC 需求点]
        B --> B1[保存 source prd 原文并冻结 prdHash]
        B1 --> C[Gate A 提取遗漏审查]
        C -->|pass 无遗漏| D[Specify 生成 EARS Spec]
        C -->|fix 漏提| C1[Gate A Fix 追加 SRC]
        C1 --> C
        C -->|两轮未过| Z1[工作流终止 Specify 不启动]
        D --> E[EARS 格式门禁 确定性无 LLM]
        E -->|失败| Z2[终止并输出诊断]
        E -->|通过| F[EARS 语义门禁 最多两轮]
        F -->|pass| G[Source Mapping 填写处置映射]
        F -->|fix 局部问题| F1[EARS Fix 局部修复]
        F -->|clarify 业务歧义| F2[checkpoint 人工澄清后修订]
        F1 --> E
        F2 --> E
        F -->|两轮未过| Z2
        G --> H[Source Coverage 结构门禁]
        H -->|通过| I[Gate B 语义保真审查]
        H -->|失败| H1[Source Map Fix 修复]
        H1 --> H2[重跑链 EARS 格式校验与语义重审]
        H2 --> H
        H -->|两轮未过| Z3[工作流终止]
        I --> I1[冻结三哈希 prdHash specHash sourceMapHash]
        I1 -->|pass 全部保真| K[进入 Plan]
        I1 -->|fix 语义问题| I2[Preservation Fix 修复]
        I1 -->|clarify 无法判定| I3[checkpoint 人工澄清后修订]
        I2 --> I4[重跑链 EARS 格式 语义重审 Source Coverage]
        I3 --> I4
        I4 --> I
        I1 -->|两轮未过| Z3
    end

    subgraph SG2 [实现收敛阶段]
        K[Plan 生成技术方案] --> L[Tasks 生成任务清单与映射]
        L --> M[Analyze 冻结 specHash 与 Coverage 检查]
        M --> N[checkpoint 人工审批]
        N --> O[冻结审批基线]
        O --> P[Round 循环开始 最多 3 轮]
        P --> P1[审批基线校验]
        P1 --> P2[Implement 实现源码与测试或修复缺口]
        P2 --> P3[Test 运行测试生成 evidence]
        P3 --> P4[Review 逐 AC 审查并冻结 specHash]
        P4 --> P5[Converge 七条件 C1 到 C7 判定]
        P5 -->|收敛| Q[输出 converged]
        P5 -->|未收敛| P6[追加 findings 到任务清单]
        P6 -->|未达最大轮次| P
        P6 -->|达到最大轮次| R[输出 not converged]
    end
```

## 二、阶段与门禁一览

| 阶段 | 执行者 | 产物 | 确定性校验 | 失败行为 |
|------|--------|------|-----------|---------|
| Intake | Intake Agent（general） | source-prd.md、source-map.json（sources 含 claimType/loadBearing/sourceRef） | freeze-source-map.mjs 冻结 prdHash | 冻结失败即终止 |
| Gate A 提取遗漏 | Intake-Preservation-Reviewer（explore 只读，宿主 extract-agent-json 落盘） | intake-review.json（missedClaims + verdict） | validate-intake-review.mjs（--expect pass/fix） | fix 走 Gate-A-Fix 补 SRC，两轮未过终止，Specify 不启动 |
| Specify | Specify Agent（general） | spec.md（EARS 句式，逐 SRC 对照） | — | — |
| EARS 格式门禁 | 确定性，无 LLM | — | validate-ears.mjs（七类结构错误） | 失败即终止（P0 级格式错误不自动修复） |
| EARS 语义门禁 | EARS-Review（general） | ears-review.json | ears-review-verdict.mjs（--expect pass/fix/clarify） | fix 自动修复、clarify 走 checkpoint，修复后重过格式门禁；两轮未过终止 |
| Source Coverage | Source-Mapping Agent（general） | source-map.json（mappings：covered/excluded/pending） | validate-source-map.mjs（结构/归属/引文/AC 强制/反向防漏） | 失败走 Source-Map-Fix + 重跑链（EARS 格式与语义重审）；两轮未过终止 |
| Gate B 语义保真 | Claim-Preservation-Reviewer（explore 只读，宿主落盘） | preservation-review.json（六状态逐 Claim + 三哈希） | freeze-preservation.mjs + validate-preservation.mjs（--expect pass/fix/clarify） | fix/clarify 修复后走重跑链并重审；两轮未过终止，Plan 不启动 |
| Plan | Plan Agent（general） | plan.md | — | — |
| Tasks | Tasks Agent（general） | tasks.md、traceability.json | — | — |
| Analyze | 确定性 | — | freeze-traceability.mjs、coverage.mjs | 失败即终止 |
| 人工审批 | checkpoint | — | — | 人工拒绝则终止 |
| 基线冻结 | 确定性 | approved-baseline | freeze-baseline.mjs | 失败即终止 |
| Implement | Coding Agent（general） | 源码 + 测试 | check-baseline.mjs（每轮前置） | 基线失效即终止 |
| Test | run-tests.mjs | evidence.json | — | 执行器自身异常终止 |
| Review | Reviewer Agent（general） | review.json（逐 AC verifications） | freeze-review.mjs、validate-review.mjs | 结构非法终止 |
| Converge | is-converged.mjs | converge-report.json | C1 到 C7 全过才收敛 | 未收敛追加 findings 进入下一轮，最多 3 轮 |

## 三、关键机制说明

1. **四道门禁的分工**：validate-source-map 管 SRC 到 Spec 的结构；Gate A 管 PRD 到 SRC 的完整性；Gate B 管 SRC 到 Spec 的语义保真；EARS 双门禁管 Spec 内部质量。全部通过才能进入 Plan。
2. **失效校验重跑链**：任何 Agent 修改 spec.md 后，EARS 格式校验、EARS 语义重审、Source Coverage、Gate B 必须针对同一版本 Spec 重新成立；Gate B 的三哈希（prdHash/specHash/sourceMapHash）锚定保证过期审查结论被确定性拒绝。
3. **只读纪律**：Gate A 与 Gate B 的 Reviewer 均为 explore 只读，产物经宿主 extract-agent-json.mjs 落盘，禁止 Reviewer 自写结论。
4. **修复循环上限**：Gate A/Gate B/EARS 语义门禁均为最多 2 轮；Implement 到 Converge 循环默认 3 轮（maxRounds 参数可调）。
5. **决定性测试钩子**：skipRequirement 参数可要求 Implement 故意跳过指定需求，用于验证 Reviewer 独立发现遗漏的能力。

## 四、变更维护

- 本文档对应 `.opencode-workflows/workflows/sdd-feature.js` 的当前 master 版本。
- 修改工作流脚本（新增/删除/移动 phase、调整门禁分支或轮次、变更产物文件名或哈希冻结点）时，必须同步更新本文档的 mermaid 图与阶段表。
- sdd-audit 工作流的图待 EARS-P5（审计来源链前置）落地后补充到本文档。
