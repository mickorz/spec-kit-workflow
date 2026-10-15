# EARS-P0 执行报告：EARS 基础契约

> 阶段：EARS-P0
> 完成日期：2026-10-15
> 执行文档：`dev-docs/planning/EARS改造-P0-执行文档.md`
> 状态：完成（确定性部分全部通过；LLM 运行时链路待手动测试，见手动测试文档）

## 一、交付清单

| 任务 | 交付物 | 结果 |
|------|--------|------|
| E0-T01 | `sdd/rules/ears-format.md` | 新增。五句式 + 复合句式 + 主体选择 + 质量标准 + 正反例 |
| E0-T02 | `sdd/templates/spec.md` | 重写为 EARS 模板。FR/NFR 均含 AC 块，支持多行折行 |
| E0-T03 | `sdd/tools/spec-parser.mjs` | 新增统一解析器（纯函数，多行 AC 块级解析，孤儿 AC 检出） |
| E0-T04 | `sdd/tools/validate-ears.mjs` | 新增确定性校验器（7 类错误：syntax/multi-behavior/empty-segment/no-ac/orphan-ac/duplicate-id/bad-id），支持 `--json` |
| E0-T04 | `sdd/tools/validate-ears-example.mjs` | 用例矩阵 V01-V13，13/13 通过 |
| E0-T05 | `sdd/tools/coverage.mjs` | 改用统一解析器；新增：NFR 空 acceptanceIds 拒绝、AC 归属校验、反向 AC 存在性校验、孤儿 AC 检出 |
| E0-T06 | `sdd/tools/audit-spec-parse.mjs` | 改为统一解析器的 CLI 封装，stdout JSON 结构不变 |
| E0-T07 | `sdd-feature.js` | Specify prompt 重写（读取规则+模板，9 条约束）；插入 1.5 EARS 格式门禁（Plan 之前） |
| E0-T08 | `sdd-feature.js` | Tasks prompt：NFR acceptanceIds 不允许为空 + AC 归属约束；示例 JSON 修正 |

## 二、测试结果

### validate-ears 用例矩阵（13/13）

V01 五句式正例、V02 复合句式、V03 多行折行、V04 全角逗号归一化、V05 缺 shall、V06 双 shall、V07 中文关键字、V08 空条件段、V09 FR 无 AC、V10 NFR 无 AC、V11 孤儿 AC、V12 重复 ID、V13 诊断格式综合——全部符合预期。

### 工具链冒烟（specs/ears-smoke 临时目录，已清理）

- `validate-ears.mjs`：通过（FR 1 / NFR 1 / AC 3）。
- `freeze-traceability.mjs` → `coverage.mjs`：通过，NFR AC 覆盖统计输出正常。
- `audit-spec-parse.mjs`：与 coverage 解析结果一致（同一解析器）。

### Coverage 负向回归

- NFR acceptanceIds 置空 → 拒绝（"EARS 契约要求 NFR 逐 AC 映射"）。
- AC-001 错误映射到 NFR-001 → 拒绝（"AC AC-001 属于 FR-001，不能映射到 NFR-001"）。
- 旧版自然语言 spec（specs/login）→ 32 处问题被拒（5 个 NFR 无 AC + 27 条 AC 非 EARS 句式）。Breaking Change 符合预期：旧 Spec 不再通过门禁。

## 三、实现要点与偏差

1. **空条件段（V08）**：`When ,` 在句式正则层即被拒（条件段要求 `\S` 开头），报 syntax 而非 empty-segment——比执行文档预期更早拦截，行为正确，已修正用例预期。
2. **UBIQ 句式无条件段**：段检查对全局约束句式跳过条件段校验（设计如此，非缺陷）。
3. **bad-id 检查**：对正文中非三位数字的 ID 写法（如 FR-1）报 bad-id。
4. 执行文档中规划的 `--json` 诊断输出已实现，供 P1 语义门禁机读。

## 四、遗留问题

1. `sdd.feature()` 全链路（Specify 由 LLM 生成 EARS spec → 门禁 → Plan → …）需要 OpenCode 运行时，本阶段未执行，列入手动测试文档。
2. 旧 specs/login、experiment-B-01~03、task-manager 均为旧格式，再跑工作流会被 EARS 门禁拒绝（预期行为，需重新生成）。
3. audit-fixtures / blind-test 的 spec 仍为旧格式，P1 E1-T07 处理。

## 五、commit 记录

见仓库提交历史（本报告与代码同批提交）。
