# LPRD-P3 执行报告：sdd_feature 大文档模式集成

> 阶段：LPRD-P3
> 完成日期：2026-10-16
> 执行文档：`dev-docs/planning/LPRD-P3-执行文档.md`
> 状态：完成（确定性部分全部通过；LLM 端到端转入手动测试文档第六层）

## 一、交付清单

| 任务 | 交付物 | 结果 |
|------|--------|------|
| T01 | `sdd-feature.js` 大文档模式 | prdPath 输入（goal 与 prdPath 至少其一）；Intake 分支：切块（--force）→ validate-chunks → 逐块提取循环（--exists 探针遍历，单块 2 轮重试，任一块失败终止）→ Merge Agent + merge-claims（--expect ok/conflict，冲突 checkpoint 人工裁决写入 conflict-decisions.md 后重并，2 轮）→ freeze-source-map → 容量门禁 → 逐块 Chunk Gate A（explore + extract-agent-json + validate-chunk-review）→ 聚合 + 补漏重聚（2 轮）→ run-report 落盘 |
| T02 | Specify 大文档变体 | demandHeader：读 source-map sources 逐条对照，按 sourceRef 读 Chunk 片段，**不读 source-prd.md 全文**；短模式 prompt 保持不变 |
| T03 | Gate B 大文档变体 | 证据源改为 source-map 逐 Claim 的 sourceRef（绝对行号 + quote + chunkId）+ intake/chunks/ 片段定位，不读全文；validate-preservation 零改动（哈希校验与阅读方式无关） |
| T04 | `sdd/tools/check-capacity.mjs` | 三阈值（maxClaims / maxOversizeChunks / maxTotalTokens，读 config largePrd 节，带默认值）；超限写 capacity-report.json 并明确阻断；CAP-01~03 验证 |
| T05 | `sdd/config.json` | 新增 largePrd 配置节（budgetTokens 3000 / overlapBlocks 1 / maxClaims 400 / maxOversizeChunks 0 / maxTotalTokens 300000） |
| T06 | `sdd/tools/run-report.mjs` | 确定性汇总（块数/Claim/审查轮次/合并去重/冲突/容量/聚合结论）写 intake/run-report.json；RUN-01 验证 |
| T07 | 文档同步 | docs/workflows.md（新增大文档模式子图 + 阶段表 3 行 + 机制说明第 6 条，按 CLAUDE.md 规则同步）；glossary 新增 3 术语；手动测试文档新增第六层 T6.1~T6.6 |
| 测试 | `sdd/tools/check-capacity-example.mjs` | **4/4 通过** |

## 二、测试结果

### 确定性

| 套件 | 结果 |
|------|------|
| CAP-01 Claim 超限阻断（capacity-report 落盘） | 通过 |
| CAP-02 oversize 阻断 | 通过 |
| CAP-03 未超限放行 | 通过 |
| RUN-01 run-report 汇总字段（chunks/claims/reviews/merge/capacity/intakeReview） | 通过 |
| 全部 7 个 example 矩阵回归（V 13 / S 16 / PV 12 / C 11 / CL+M 13 / CR 8 / CAP 4） | 77/77 全过 |
| 全部 .mjs + sdd-feature.js `node --check` | 通过 |

### 工作流结构

- 短模式：goal 输入，行为与 EARS-P3 完全一致（不产生 intake/）。
- 大模式阶段顺序：Intake[chunker → 逐块提取 → 合并(冲突裁决) → freeze → 容量门禁 → 逐块 Gate A → 聚合(补漏重聚) → run-report] → Specify(变体) → EARS 双门禁 → Source Coverage → Gate B(变体) → Plan → ...

### 运行时（移交手动测试第六层）

T6.1 ≥2 万字 PRD 端到端、T6.2 漏提注入重聚、T6.3 跨章节冲突裁决、T6.4 容量阻断、T6.5 短模式零回归、T6.6 成本统计。

## 三、实现要点

1. **三不读全文**：Specify（source-map 清单 + 按行号读片段）、Gate B（逐 Claim sourceRef 定位片段）、Chunk 提取/审查天然只读单块——大模式下任何 Prompt 都不含整份 PRD。
2. **探针遍历**：workflow VM 无 fs，用 validate-chunks --exists 按序探测 CHUNK-001..200 实现块遍历（MAX_CHUNKS=200，容量门禁在更早处拦截超量场景）。
3. **冲突裁决文件化**：checkpoint 要求人工把裁决写入 intake/conflict-decisions.md，第二轮 Merge Agent 按裁决重出 semantic.json——裁决内容落盘可审计，避免 headless approve 被当作裁决（同 EARS-P1 警示）。
4. **退出码三态适配**：merge-claims --expect ok/conflict/fail 复用 commandSuccess 布尔探测方案。
5. **补漏联动**：Large-GateA-Fix 同时追加 source-map 与对应块 claims 文件（相对行号换算公式写入 prompt），重过 validate-claims 防换算错误，重聚即恢复 pass（LPRD-P2 CR-07 机制）。

## 四、遗留问题

1. LLM 端到端（≥2 万字真实 PRD）未跑，全部转入手动测试第六层（E2E-01~05 + 成本统计）。
2. 逐块提取与块审查当前串行执行；并行化（parallel）待真实成本数据后评估。
3. 无换行巨型段落场景（整体 oversize）由容量门禁拦截报告，不做句级切分（LPRD-P0 已声明的边界）。

## 五、commit 记录

见仓库提交历史（本报告与代码同批提交）。
