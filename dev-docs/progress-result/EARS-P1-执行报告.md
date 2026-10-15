# EARS-P1 执行报告：质量门禁与端到端集成

> 阶段：EARS-P1
> 完成日期：2026-10-15
> 执行文档：`dev-docs/planning/EARS改造-P1-执行文档.md`
> 状态：完成（确定性部分全部通过；LLM 运行时链路待手动测试，见手动测试文档）

## 一、交付清单

| 任务 | 交付物 | 结果 |
|------|--------|------|
| E1-T01 | `sdd/rules/ears-semantic-review.md` | 新增。8 个审查维度、verdict 判定纪律、issue 结构契约 |
| E1-T01 | `sdd/tools/ears-review-verdict.mjs` | 新增确定性读取器。verdict 枚举/blocker 一致性/target 引用校验；`--expect` 模式适配 workflow 仅有的 commandSuccess 布尔原语（0/2/3 退出码无法直接读取） |
| E1-T02 | `sdd-feature.js` 1.6 节 | EARS 语义门禁 + 最多 2 轮修复循环 + clarify 走 checkpoint 人工澄清；修复/澄清修订后强制重过格式门禁；log 区分 ears-pass / semantic-fix / semantic-clarify / format-error 四种状态 |
| E1-T03 | `sdd/tools/validate-review.mjs` | 统一解析器；逐 AC 证据覆盖（verifications 必须覆盖该需求全部 AC）；废除 NFR `ac: null` 免检路径；evidenceRefs 归属校验 |
| E1-T04 | `sdd/tools/is-converged.mjs` | C2/C4 改用统一解析器；C4 逐 AC 判定（缺口按 AC-NNN 列出）；删除 NFR ac=null 验证分支 |
| E1-T05 | `sdd-audit.js` + `sdd/tools/audit-converge.mjs` | 审计链逐 AC 化：Reviewer prompt 禁止 ac=null、示例改为真实 AC 引用；C2 增加归属与存在性校验；C4 以 spec 解析出的 AC 全集为准（NFR 无免检）；保留 fileRef 存在性检查 |
| E1-T06 | `sdd-feature.js` Review prompt | NFR 示例改为逐 AC（AC-003 + fileRef）；新增"verifications 必须覆盖全部 AC、禁止 ac 为 null"约束 |
| E1-T07 | `experiments/fixtures/frozen-spec.md` | 全量 EARS 化：27 条 AC 语义保持、ID 不变；5 个 NFR 补充 AC-028~AC-033（共 33 条 AC）。standard-answers.json 的 FR 级键不受影响 |

## 二、测试结果

### 确定性验证（本机执行）

| 用例 | 结果 |
|------|------|
| 全部 8 个 .mjs 工具 `node --check` 语法 | 通过 |
| frozen-spec EARS 校验 | 通过（7 FR / 5 NFR / 33 AC 全部符合句式） |
| NFR AC 归属解析（AC-028~033 → NFR-001~005） | 正确 |
| ears-review-verdict：pass / fix / clarify 三态 + `--expect` 模式 | 全部正确退出 |
| ears-review-verdict：blocker 与 pass 矛盾 → 结构非法 | 正确拒绝 |
| validate-review：NFR `ac: null` 旧式条目 | 拒绝（"EARS 契约禁止，NFR 必须逐 AC"） |
| validate-review：修正为逐 AC 后 | 通过（12 需求 / 33 AC 全覆盖） |
| is-converged：完整产物闭环（33 AC 全部 automated_test） | converged=true，C1-C7 全 PASS |
| audit-converge：正向 | converged=true |
| audit-converge：删除 AC-028 证据 | C4 拒绝并列出 "NFR-001: AC AC-028 缺少 verification 条目"；C2 列出未覆盖 AC |
| validate-ears-example 回归 | 13/13（P0 无回归） |
| coverage：frozen-spec + 12 映射（含 6 条 NFR AC） | 通过 |

### 运行时验证（需 OpenCode + LLM，移交手动测试文档）

R01-R05（语义门禁正反向）、R06-R07（逐 AC 证据缺失）、R08（skipRequirement 决定性测试）、R09-R10（v1-v4 夹具审计、源码修改判 invalid）。

## 三、实现要点与偏差

1. **`--expect` 适配**：workflow 运行时（opencode-dynamicworkflows）仅提供 `commandSuccess` 布尔原语，无裸退出码读取。verdict 工具增加 `--expect pass|fix|clarify|invalid` 模式（匹配期望退出 0），语义门禁用三次 commandSuccess 探测 verdict，行为等价。
2. **修复循环上限**：2 轮，每轮 = 语义审查 + （clarify→checkpoint+修订 或 fix→局部修复）+ 格式重校验。两轮后仍未 pass 则 check 失败终止（真歧义应已被 clarify 路径承接）。
3. **frozen-spec 的 AC-005/011 等复合语义**：保持单 shall，用括号补语承载配置分支细节（如"策略为区分时登录失败，策略为不区分时登录成功"），未拆分 AC 以保持 ID 稳定与标准答案兼容。
4. **审计夹具**：blind-test/project-a~d 的 spec 由 `experiments/fixtures/frozen-spec.md` 在审计时传入（目录内无独立 spec.md），转换 frozen-spec 即全量覆盖；standard-answers.json 未改动（FR 级期望不变，NFR 新增 AC 在 v1-complete 中有对应实现：bcrypt/审计日志/统一错误提示等）。

## 四、遗留问题

1. `sdd.feature()` 与 `sdd.audit()` 的 LLM 运行时端到端（含语义门禁修复循环、决定性测试、盲测对齐）——全部列入手动测试文档。
2. specs/login、experiment-B-01~03、task-manager 为旧格式，重跑工作流将被 EARS 门禁拒绝（预期行为）。
3. 旧版 P0.7 盲测结论基于旧格式 spec，新盲测需按手动测试文档重跑一轮以重新校准。

## 五、commit 记录

见仓库提交历史（本报告与代码同批提交）。
