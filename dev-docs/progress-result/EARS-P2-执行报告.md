# EARS-P2 执行报告：PRD 来源追踪与防遗漏审计

> 阶段：EARS-P2
> 完成日期：2026-10-15
> 执行文档：`dev-docs/planning/EARS改造-P2-执行文档.md`（同日按新定位重写后执行）
> 状态：完成（确定性部分全部通过；LLM 运行时链路待手动测试文档第四层验证）

## 一、定位调整记录

本轮按新需求输入将 P2 从"PRD → Spec 转换"（与已有 Specify 重复，废弃）调整为"PRD → Spec 来源追踪与防遗漏审计"，只补三个能力：Source Extraction（SRC-ID 提取）、Source Traceability（SRC → FR/NFR/AC 映射）、Source Coverage Gate（确定性防漏校验 + 无依据新增拦截）。早期 `prd-spec部分的需求补充1.md` 中设想的 sdd.intake / analyzeSourceCoverage 由本次实现承接（多轮 clarify 不在本期范围）。

## 二、交付清单

| 任务 | 交付物 | 结果 |
|------|--------|------|
| E2-T01 | `sdd/rules/source-extraction.md` | 新增。提取粒度锚点、confirmed/assumed 纪律、disposition 判定、无依据新增处置路径 |
| E2-T02 | `sdd/tools/validate-source-map.mjs` | 新增 Source Coverage Gate。12 类错误确定性检查（含反向 unsupported-requirement 与 prdHash），支持 `--json` |
| E2-T02 | `sdd/tools/freeze-source-map.mjs` | 新增。冻结 source-prd.md 哈希到 prdHash（LLM 无法可靠计算 sha256） |
| E2-T03 | `sdd/tools/validate-source-map-example.mjs` | 用例矩阵 S01-S12，12/12 通过 |
| E2-T04 | `sdd-feature.js` | 新增 `phase('Intake')`（Specify 之前，prdHash 冻结）与 `phase('Source Coverage')`（EARS 双门禁之后、Plan 之前：Mapping Agent + Gate + 一轮修复循环）；Specify prompt 增加逐 SRC 对照约束 |
| E2-T05 | `docs/glossary.md` | 新增 SRC / Intake / source-map / disposition / Source Coverage Gate / EARS 术语；修正过时的"NFR 可无 AC"描述（EARS 契约下 NFR 必须有 AC） |
| E2-T05 | `dev-docs/design/sdd-artifact-contract.md` | 登记 source-prd.md 与 source-map.json（3.0 节）与速查表 |
| E2-T05 | `docs/ears-manual-testing.md` | 新增第四层 T4.1-T4.4 手动测试与判定表 |

## 三、测试结果

### 确定性（本机执行）

| 用例组 | 结果 |
|--------|------|
| validate-source-map S01-S12 | 12/12（含正例、excluded/pending 路径、缺 mapping、无理由排除、空引用、未知 ID、归属错误、无依据新增、重复 SRC、prdHash、pending 带映射） |
| validate-ears V01-V13 回归 | 13/13（P0 无回归） |
| frozen-spec EARS 复验 | 通过（7 FR / 5 NFR / 33 AC） |
| 全部 .mjs `node --check` | 通过 |

设计修正记录：S02 初版用例自相矛盾（excluded 掉性能 SRC 但 spec 仍含 NFR-001，被反向防漏正确拒绝）——这本身验证了 unsupported-requirement 的正确性；修正用例配套不含 NFR 的 spec 后通过。

### 工作流结构验证

sdd-feature.js 阶段顺序（node --check 通过）：Intake → Specify → EARS 格式门禁 → EARS 语义门禁（2 轮循环）→ Source Coverage（Mapping + Gate + 1 轮修复）→ Plan → Tasks → Analyze → 审批 → Implement/Review/Converge。

### 运行时（移交手动测试文档 T4）

T4.1 Intake 全链路、T4.2 防遗漏决定性、T4.3 无依据新增拦截、T4.4 原文改写防护。

## 四、实现要点

1. **修复循环结构**：Mapping Agent 只跑一次并整体写入 mappings；后续为"校验 → 修复 → 复检"（至多一轮修复），避免重跑 Mapping 覆盖修复成果。
2. **prdHash 冻结时机**：Intake 写完 source-prd.md 后立即 freeze，后续任何阶段对原文的改写都会被 Gate 拒绝。
3. **反向防漏是核心**：covered 正向校验之外，spec 中每个 FR/NFR 必须被至少一条 covered mapping 引用；PRD 没提的性能 NFR 会被拒（确属必要须先补 PRD 重跑，不放宽门禁）。
4. **pending 不阻断**：待澄清 SRC 允许带 note 通过 Gate（真歧义交人工审批环节），excluded 同理；阻断的是"没处置"和"Spec 无依据新增"。

## 五、遗留问题

1. Intake/Mapping/Source Coverage 的 LLM 端到端未跑（T4.1-T4.4）。
2. 提取粒度跨模型一致性未验证，规则文件的粒度锚点（30 条 PRD ≈ 25~35 SRC）需运行时观察后校准。
3. 多轮 clarify（sdd.clarify 交互式澄清）与 spec-harness 式事实/假设/待确认分区模板，留待 P2 后续增强，不在本期完成条件内。

## 六、commit 记录

见仓库提交历史（本报告与代码同批提交）。
