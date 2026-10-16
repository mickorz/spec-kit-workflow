# LPRD-P1 执行报告：分块 Claim 提取与全局合并

> 阶段：LPRD-P1
> 完成日期：2026-10-16
> 执行文档：`dev-docs/planning/LPRD-P1-执行文档.md`
> 状态：完成（确定性部分全部通过；LLM 提取/语义合并链路在 P3 接线后转入手动测试）

## 一、交付清单

| 任务 | 交付物 | 结果 |
|------|--------|------|
| T01 | `sdd/rules/large-prd-intake.md` 二、三节细化 | 局部 Claim 契约（L-NNN 块内编号、相对行号、quote 块内逐字）+ 合并纪律（确定性归并/语义判定/冲突不选边） |
| T02 | `sdd/tools/validate-claims.mjs` | 块级确定性校验：结构/枚举/localId 唯一/quote 落在声明相对行号区间/行号不越界；支持单块或全量校验 |
| T03 | `sdd/tools/merge-claims.mjs` | 两段式合并：确定性部分（块级校验→相对转绝对行号【含 overlap 偏移】→quote 全文复核→完全重复归并→SRC 分配→草稿+报告骨架）；语义部分（--semantic 应用 Merge Agent 报告→正式 source-map.json，冲突退出码 2，--expect ok/conflict/fail 模式）；provenance 守恒检查 |
| 测试 | `sdd/tools/merge-claims-example.mjs` | **13/13 通过**（CL-01~06 + M01~M07） |

## 二、测试结果

| 用例 | 结果 |
|------|------|
| CL-01~06（合法块/quote 区间不符/行号越界/枚举外/localId 重复/空块合法） | 6/6 |
| M01 相对转绝对行号换算（全文复核通过） | 通过 |
| M02 跨块完全重复归并（PRD 重复句天然构造，merged 含 L-002@CHUNK-002） | 通过 |
| M03 语义重复归并（不同 quote 判重，alsoFrom 保留来源） | 通过 |
| M04 冲突退出码 2 + --expect conflict | 通过 |
| M05 SRC 分配顺序唯一（3 SRC 按块序+行号） | 通过 |
| M06 生成 source-map 被 EARS-P3 契约接受（仅 missing-mapping/unsupported-requirement 类错误——mappings 由后续阶段填） | 通过 |
| M07 换算缺陷全文复核拦截（篡改 manifest 模拟换算 bug） | 通过 |

## 三、实现要点与排坑

1. **fixture 行号语义**（首版测试踩坑）：块级 Claim 的 lineStart/lineEnd 是 **Chunk 文件内相对行号**，不是 PRD 绝对行号；跨块完全重复测试要求 PRD 本身在两个章节包含相同句子（quote 必须真实存在于各自块内）。
2. **M06 断言设计**：merge 阶段 mappings 为空是设计使然（工作流 Source Mapping 阶段填写），正确断言是"仅允许 missing-mapping + unsupported-requirement 两类纯映射缺失错误，quote/元数据/prdHash 零错误"。
3. **换算公式**：绝对行 = Chunk 文件起点（overlapStart 或 lineStart）+ 相对行 - 1；全文复核（绝对区间含 quote）作为换算缺陷的确定性拦截网（M07 验证）。
4. **冲突退出码适配**：merge-claims 冲突时退出 2，并带 `--expect ok|conflict|fail` 模式适配 workflow 的 commandSuccess 布尔原语（与 ears-review-verdict 同款方案）。
5. **语义组与确定性组并组**：先按 quote 归并、再按语义根合并，语义报告引用不存在的 ref 直接失败。

## 四、遗留问题

1. Merge Agent 的语义去重上限（数百条 Claim 时整批输入是否超上下文）待真实长 PRD 实测，超限时按执行文档预案加层级合并。
2. Chunk-Intake / Claim-Merge 两个 Agent 的 prompt 与重试循环在 LPRD-P3 工作流接线，端到端验证转入手动测试第六层。

## 五、commit 记录

见仓库提交历史（本报告与代码同批提交）。
