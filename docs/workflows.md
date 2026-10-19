# SDD 工作流文档（sdd-feature）

> 本文档用 mermaid 记录 `.opencode-workflows/workflows/sdd-feature.js` 的完整详细流程。
> 维护规则见 `CLAUDE.md`：工作流脚本变更时必须同步更新本文档的图与阶段说明。
> 术语见 `docs/glossary.md`；Artifact 契约见 `dev-docs/design/sdd-artifact-contract.md`。
> 图中节点只标行为与产物名；工具与文件名见「阶段与门禁一览表」。

## 一、总流程总览

两种输入模式在 Intake 阶段分流，汇合后共用 Specify → EARS 双门禁 → Source Coverage → Gate B → 实现收敛的完整链路。

```mermaid
flowchart TD
    A[feature 与 goal 或 prdPath 输入] --> B{输入模式}
    B -->|仅 goal 短需求| C[短模式 Intake 与 Gate A]
    B -->|prdPath 超长 PRD| D[大文档模式 切块 分块提取 合并 逐块审查]
    C --> E[Specify 生成 EARS Spec]
    D --> E
    E --> F[EARS 格式门禁 确定性]
    F --> G[EARS 语义门禁 最多两轮]
    G --> H[Source Coverage 结构门禁 含修复]
    H --> I[Gate B 语义保真门禁 最多两轮]
    I --> J[Plan 与 Tasks 与 Analyze]
    J --> K[人工审批与基线冻结]
    K --> L[实现收敛循环 最多三轮]
    L --> M[输出 converged 或 not converged]
```

## 二、Intake 阶段详细

### 2.1 大文档模式（prdPath，LPRD）

切块 → 逐块提取局部 Claim → 语义合并（冲突人工裁决）→ 容量门禁 → 逐块漏提审查 → 聚合补漏。任何 Prompt 都不包含整份 PRD。

```mermaid
flowchart TD
    A[prdPath 超长 PRD] --> B[prd chunker 切块 原文逐字复制 冻结 prdHash]
    B --> C[validate chunks 完整性校验]
    C -->|失败| Z1[终止 覆盖缺口或切片被篡改]
    C -->|通过| D[逐块循环 exists 探针遍历]
    D --> D1[单块 Intake Agent 提取局部 Claim L 编号]
    D1 --> D2[validate claims 块级校验]
    D2 -->|失败重试 最多两次| D1
    D2 -->|两轮失败| Z2[终止 任一块失败不得跳过]
    D2 -->|通过 下一块| D
    D -->|全部块完成| E[Claim Merge Agent 语义去重与冲突登记]
    E --> F[merge claims 确定性归并与 SRC 分配]
    F -->|存在未解决冲突| G[checkpoint 人工裁决写入决定文件]
    G --> E2[Merge Agent 按裁决重出报告]
    E2 --> F
    F -->|两轮未决| Z3[终止 冲突未解决]
    F -->|合并成功| H[freeze source map 冻结 prdHash]
    H --> I[check capacity 容量门禁]
    I -->|超限| Z4[明确阻断 保留 intake 中间产物 禁止截断]
    I -->|通过| J[逐块 Chunk Gate A explore 只读审查]
    J --> K[validate chunk review 块级校验]
    K -->|结构非法| Z5[终止]
    K -->|通过 全部块完成| L[aggregate 聚合为 intake review]
    L -->|存在未解决遗漏| M[Large GateA Fix 补漏 追加 SRC 与块内 Claim]
    M --> N[validate claims 复验 行号换算]
    N --> L
    L -->|两轮未过| Z6[终止 Specify 不启动]
    L -->|通过| O[run report 成本统计落盘]
    O --> P[汇入 Specify]
```

### 2.2 短需求模式（goal）

```mermaid
flowchart TD
    A[goal 原始需求] --> B[Intake Agent 原文逐字写入 source prd 提取 SRC 含 Claim 元数据]
    B --> C[freeze source map 冻结 prdHash]
    C --> D[Gate A explore 只读独立重读原文比对 SRC 台账]
    D --> E[validate intake review 确定性校验]
    E -->|pass| F[汇入 Specify]
    E -->|fix 漏提| G[Gate A Fix 追加缺失 SRC]
    G --> D
    E -->|两轮未过| Z[终止 Specify 不启动]
```

## 三、Specify 与 EARS 双门禁详细

```mermaid
flowchart TD
    A[Specify Agent] --> A1{模式}
    A1 -->|短模式| A2[依据 goal 逐 SRC 对照生成 spec]
    A1 -->|大模式| A3[依据 source map 清单生成 按行号读 Chunk 片段 不读全文]
    A2 --> B[spec md 生成]
    A3 --> B
    B --> C[validate ears 格式门禁 确定性无 LLM]
    C -->|失败| Z1[终止 输出七类错误诊断]
    C -->|通过| D[EARS 语义门禁 循环最多两轮]
    D --> D1[语义 Reviewer 写 ears review]
    D1 --> D2[ears review verdict 三态探测 pass fix clarify]
    D2 -->|pass| E[双门禁通过]
    D2 -->|fix 局部问题| D3[EARS Fix 只修 blocker 保留 ID 与句式]
    D3 --> D4[validate ears 格式重检]
    D4 --> D
    D2 -->|clarify 业务歧义| D5[checkpoint 人工澄清]
    D5 --> D6[按澄清结论修订 spec 待澄清标记替换为保守表述]
    D6 --> D4
    D -->|两轮未过| Z2[终止 真歧义应走人工澄清]
```

## 四、Source Coverage 详细（含重跑链）

```mermaid
flowchart TD
    A[Source Mapping Agent 填写处置映射 covered excluded pending] --> B[validate source map 结构门禁]
    B -->|通过| C[汇入 Gate B]
    B -->|失败| D[Source Map Fix 按诊断修复 映射或删无依据需求或补 AC 或修正 quote]
    D --> E[重跑链 validate ears 格式重检]
    E --> F[重跑链 EARS Review Rerun 语义重审一次]
    F -->|重审非 pass| Z1[终止 需人工介入]
    F -->|通过| B
    B -->|修复一轮后仍未过| Z2[终止 PRD 需求未被完整处置]
```

## 五、Gate B 语义保真详细（含重跑链）

```mermaid
flowchart TD
    A[Claim Preservation Reviewer explore 只读] --> A1{证据来源模式}
    A1 -->|短模式| A2[读 source prd 全文与 source map]
    A1 -->|大模式| A3[读 source map 逐 Claim 的 sourceRef 与 Chunk 片段 不读全文]
    A2 --> B[逐 SRC 六状态判定 输出纯 JSON]
    A3 --> B
    B --> C[extract agent json 宿主提取落盘]
    C --> D[freeze preservation 冻结三哈希]
    D --> E[validate preservation 确定性门禁]
    E -->|pass| F[汇入 Plan]
    E -->|fix 语义问题| G[Preservation Fix 修 spec 补条件修数值补例外]
    E -->|clarify 无法判定| H[checkpoint 人工澄清后修订]
    H --> I[重跑链 格式重检 语义重审 Source Coverage 复验]
    G --> I
    I --> A
    E -->|两轮未过| Z[终止 Plan 不启动 过期结论被哈希拒绝]
```

## 六、实现收敛阶段详细

```mermaid
flowchart TD
    A[Plan Agent 生成 plan md] --> B[Tasks Agent 生成 tasks md 与 traceability json]
    B --> C[freeze traceability 冻结 specHash]
    C --> D[coverage 覆盖率门禁 FR NFR AC 全映射]
    D --> E[checkpoint 人工审批 批准进入编码]
    E --> F[freeze baseline 冻结审批基线]
    F --> G[Round 循环 最多三轮]
    G --> H[check baseline 每轮前置 基线失效即终止]
    H --> I[Implement Agent 首轮实现源码与测试 后续按 findings 修复]
    I --> J[run tests 生成 evidence json 逐测试详情]
    J --> K[Review Agent 逐 AC verifications 写 review json]
    K --> L[freeze review 填充 specHash]
    L --> M[validate review 结构校验]
    M --> N[is converged 七条件 C1 到 C7 判定]
    N -->|收敛| O[输出 converged]
    N -->|未收敛且未达上限| P[append findings 追加修复任务]
    P --> G
    N -->|达到最大轮次| Q[输出 not converged]
```

## 七、阶段与门禁一览

| 阶段 | 执行者 | 产物 | 确定性校验 | 失败行为 |
|------|--------|------|-----------|---------|
| Intake（短模式 goal） | Intake Agent（general） | source-prd.md、source-map.json（sources 含 claimType/loadBearing/sourceRef） | freeze-source-map.mjs 冻结 prdHash | 冻结失败即终止 |
| Intake（大模式 prdPath，LPRD） | prd-chunker + Chunk-Intake-*（general 逐块） + Claim-Merge（general） | intake/manifest.json + chunks/ + claims/ + semantic.json + merge-report.json + source-map.json | validate-chunks / validate-claims / merge-claims（--expect ok/conflict）/ check-capacity | 任一块提取两轮失败、冲突未决、容量超限均终止并保留中间产物 |
| Chunk Gate A（大模式，LPRD） | Chunk-GateA-CHUNK-NNN（explore 只读，宿主提取落盘） | intake/reviews/ + 聚合 intake-review.json | validate-chunk-review / aggregate-intake-review（--expect） | 遗漏补漏后重聚，两轮未过终止，Specify 不启动 |
| Gate A（短模式） | Intake-Preservation-Reviewer（explore 只读，宿主提取落盘） | intake-review.json（missedClaims + verdict） | validate-intake-review.mjs（--expect pass/fix） | fix 走 Gate-A-Fix 补 SRC，两轮未过终止，Specify 不启动 |
| Specify | Specify Agent（general；大模式读清单不读全文） | spec.md（EARS 句式，逐 SRC 对照） | — | — |
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

## 八、关键机制说明

1. **四道门禁的分工**：validate-source-map 管 SRC 到 Spec 的结构；Gate A 管 PRD 到 SRC 的完整性；Gate B 管 SRC 到 Spec 的语义保真；EARS 双门禁管 Spec 内部质量。全部通过才能进入 Plan。
2. **失效校验重跑链**：任何 Agent 修改 spec.md 后，EARS 格式校验、EARS 语义重审、Source Coverage、Gate B 必须针对同一版本 Spec 重新成立；Gate B 的三哈希（prdHash/specHash/sourceMapHash）锚定保证过期审查结论被确定性拒绝。
3. **只读纪律**：Gate A 与 Gate B 的 Reviewer 均为 explore 只读，产物经宿主 extract-agent-json.mjs 落盘，禁止 Reviewer 自写结论。
4. **修复循环上限**：Gate A/Gate B/EARS 语义门禁均为最多 2 轮；块提取单块最多 2 次；Claim 合并最多 2 轮；Implement 到 Converge 循环默认 3 轮（maxRounds 参数可调）。
5. **决定性测试钩子**：skipRequirement 参数可要求 Implement 故意跳过指定需求，用于验证 Reviewer 独立发现遗漏的能力。
6. **大文档模式（LPRD）**：prdPath 触发；容量门禁三项阈值（Claim 总数 / oversize 块 / 总 Token）来自 sdd/config.json 的 largePrd 节，超限明确阻断并保留 intake/ 中间产物；处理状态与成本统计落盘 intake/run-report.json；Specify 与 Gate B 在大模式下读 source-map 与 Chunk 片段，不读全文。
7. **退出码三态适配**：workflow 运行时只提供 commandSuccess 布尔原语，各 verdict 工具（ears-review-verdict / merge-claims / validate-preservation / validate-intake-review / validate-chunk-review / aggregate-intake-review）均带 --expect 模式，用多次布尔探测区分 pass/fix/clarify。

## 九、变更维护

- 本文档对应 `.opencode-workflows/workflows/sdd-feature.js` 的当前 master 版本（含 EARS-P0~P3 与 LPRD-P0~P3）。
- 修改工作流脚本（新增/删除/移动 phase、调整门禁分支或轮次、变更产物文件名或哈希冻结点）时，必须同步更新本文档的 mermaid 图与阶段表。
- sdd-audit 工作流的图待 EARS-P5（审计来源链前置）落地后补充到本文档。
