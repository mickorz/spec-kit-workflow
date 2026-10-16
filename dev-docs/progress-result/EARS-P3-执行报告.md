# EARS-P3 执行报告：Claim 逐条保真闭环

> 阶段：EARS-P3
> 完成日期：2026-10-16
> 执行文档：`dev-docs/planning/EARS改造-P3-执行文档.md`
> 状态：完成（确定性部分全部通过；LLM 运行时链路待手动测试文档第五层验证）

## 一、交付清单

| 任务 | 交付物 | 结果 |
|------|--------|------|
| T01 | `sdd/rules/source-extraction.md` 扩展 | claimType 六枚举 / loadBearing / sourceRef（quote 逐字引文）契约 + AC 映射强制规则 |
| T02 | `sdd/rules/claim-preservation.md` 新增 | Gate A 独立重读纪律 + Gate B 六状态/组合语义/数值与例外敏感性/证据要求/verdict 纪律 |
| T03 | `validate-source-map.mjs` 强化 | 新增 6 类错误：missing-claim-meta / bad-claim-type / bad-load-bearing / bad-source-ref / quote-mismatch / ac-required；引文一致性按行号区间归一化匹配 |
| T03 | `validate-source-map-example.mjs` 扩展 | S13-S16 新增，**16/16 通过** |
| T04 | `extract-agent-json.mjs` 新增 | 参数化 journal 提取（--label/--agentType/--out），取最新匹配 entry，.raw 兜底 |
| T05 | `validate-intake-review.mjs` 新增 | Gate A 确定性校验（prdHash 锚定、missedClaims 引文存在性、verdict 一致性），--expect 三态；IR 三态实测通过 |
| T06 | `validate-preservation.mjs` + `freeze-preservation.mjs` + `validate-preservation-example.mjs` | Gate B 确定性门禁：三哈希锚定（P3-07 过期拒绝）、claims 全 SRC 覆盖、六状态证据、verdict/blocker 一致性、unsupportedRequirements；**PV-01~12 全过** |
| T07 | `sdd-feature.js` 接入 | Gate A（Intake 后、Specify 前，2 轮补漏）、Gate B（Source Coverage 后、Plan 前，fix/clarify + 修复）、两处重跑链（Source-Map-Fix 与 Gate B 修复后：validate-ears → EARS 语义重审 → validate-source-map → Gate B 重审） |
| T08 | 文档同步 | glossary 新增 9 个术语；artifact 契约登记 intake-review.json / preservation-review.json（含速查表）；手动测试文档新增第五层 T5.1-T5.5 |

## 二、测试结果

### 确定性（本机）

| 套件 | 结果 |
|------|------|
| validate-ears-example（V01-V13 回归） | 13/13 |
| validate-source-map-example（S01-S16） | 16/16 |
| validate-preservation-example（PV-01~12） | 12/12 |
| validate-intake-review 三态（pass/fix/invalid 含引文存在性拒绝） | 全部正确 |
| 全部 .mjs + 两个 workflow `node --check` | 通过 |
| frozen-spec EARS 复验 | 通过（无 P0-P2 回归） |

### 工作流结构

阶段顺序（node --check 通过）：Intake → **Gate A** → Specify → EARS 格式门禁 → EARS 语义门禁 → Source Coverage（含重跑链）→ **Gate B**（含重跑链）→ Plan → Tasks → Analyze → 审批 → Implement/Test/Review/Converge。

### 运行时（移交手动测试第五层）

T5.1 Gate A 漏提拦截（P3-01）、T5.2 Gate B 语义矛盾/数值曲解/例外丢失（P3-02/03/04）、T5.3 过期 Review 拒绝（P3-07）、T5.4 重跑链、T5.5 无依据新增语义确认（P3-09）。

## 三、实现要点与偏差

1. **Gate A 产物独立成文件**（执行文档已声明的设计偏差）：intake-review.json 锚定 prdHash，preservation-review.json 锚定三哈希，避免两阶段写入污染哈希契约。
2. **specEvidence 分级强制**：partial/contradicted 必须给 specEvidence（它们指向真实 Spec 内容）；missing/excluded/uncertain 不强制（Spec 侧无内容可引，只要求 sourceEvidence+finding）。比执行文档"非 preserved 一律强制"更精确，已按此实现并在 PV-04 验证。
3. **claims 状态与 source-map disposition 是两层**：Gate B 判 excluded 与 source-map 的 disposition=covered 不交叉校验（语义分歧留 P4 审批强化），PV-10 按此设计通过。
4. **Gate A 结构非法不修复**：missedClaims 缺失/verdict 矛盾等结构问题不触发 fix agent，直接由下一轮重审拿新鲜输出（fix 只用于真实漏提），两轮上限兜底。
5. **重跑链的 EARS 语义重审为单轮**：fix 后一次 EARS-Review-Rerun，非 pass 即终止需人工介入（预算控制，执行文档 T07 已定）。
6. **missing-claim 计入 blocker 语义**：claims 覆盖缺失时即使无显式 blocker 也禁止 verdict=pass（防止靠漏报骗通过）。

## 四、遗留问题

1. Gate A/Gate B 的 LLM 端到端（含对抗缺陷注入 P3-01~04/09）未跑，列入手动测试第五层。
2. extract-agent-json 的 journal 定位基于 mtime 取最新文件 + 同 label 取最新 entry，多 workflow 并发跑同一仓库时的隔离性需运行时观察（sdd-audit 的 extract-review 有同样假设）。
3. Gate B 每轮成本：1 次 explore 审查 + 可能 1 轮修复 + 重跑链（1 次 EARS 语义重审 + 3 次确定性校验），最坏单 Feature 增量约 6 次 Agent 调用——成本数据待手动测试记录。

## 五、commit 记录

见仓库提交历史（本报告与代码同批提交）。
