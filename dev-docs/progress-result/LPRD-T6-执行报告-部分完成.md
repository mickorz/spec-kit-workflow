# LPRD-T6 执行报告（部分完成，待续）

> 测试目标：T6.1～T6.6 真实超长 PRD 端到端验收（docs/ears-manual-testing.md 第七层）
> 执行方式：opencode run CLI 驱动，模型 `biangfeng-gateway/deepseek-v4.1-flash-official`
> 执行日期：本轮会话（T6.1 进行至 Gate A 审查阶段后按用户要求暂停）
> 状态：**T6.1 部分完成（约 60%），T6.2～T6.6 未开始**

## 一、测试环境与准备

| 项 | 内容 |
|----|------|
| 模型 | `biangfeng-gateway/deepseek-v4.1-flash-official`（网关 aimeter.xk-devops.com，modelsDiscovery 开启） |
| PRD 生成器 | `dev-examples/lprd-manual/gen-prd.mjs`（确定性生成，无 LLM） |
| 干净版 PRD | `dev-examples/lprd-manual/prd-clean.md`（22120 字符不含空白、43 条编号需求、堆叠上限统一 200） |
| 矛盾版 PRD | `dev-examples/lprd-manual/prd-conflict.md`（背包章 99 / 经济章 999 矛盾预埋，T6.3 未使用） |
| feature 注册 | `sdd/config.json` 增加 `lprd-manual-1`（appDir 指向 dev-examples/lprd-manual/app，build/test 为 npm 脚本） |
| 占位应用 | `dev-examples/lprd-manual/app`（src/index.js + package.json + tests/smoke.test.js） |
| checkpoint 预授权 | opencode.json 临时 `workflow-checkpoint:*: allow`（CLI 驱动需要；**T6.3 前应改回 ask 验证弹窗语义**） |
| 状态监控 | `t6-status.sh`（chunks/claims/reviews/merge/sem/spec/smap/plan/tasks/evid/runreport 十项） |

生成器踩坑记录：sections.push(`...`) 大模板漏了闭合 `)`（node 报错行号误导至 204 行 NFR-705，esbuild 精确定位 257 行）；`PRD` 中 `${bagLimitBag}` 占位写在双引号参数里不插值，生成后用 replaceAll 替换为 200/99/999。

## 二、T6.1 执行时间线（四轮 opencode run）

### Run 1（13:00 前后启动）

- 切块成功：**63 个 Chunk**（总 685 行，est 20590 tokens，budget 3000，overlap 1，oversize 0）
- 提取过程 Main Agent 遭遇两个 blocker 并自行修复（见第三节"发现的缺陷"）
- Run 1 进程退出后，DevJob 被 `插件重启时被中断` 标记 failed（CLI 退出杀后台链——已知坑）

### Run 2（续跑模式：`scriptPath` 直指 + claims 幂等短路）

- 63 块 claims 全部命中新加的断点续跑短路，直接进入 Claim Merge
- **Claim Merge 第 1 轮失败**：`direct model access is not allowed; request the model by its model group name`——网关计量器间歇性拒绝（网关直连 chat/completions 同模型正常；OpenCode 层模型路由间歇报错；组名为 `deepseek-flash`）
- 该轮同时暴露：workflow 无断点续跑（重跑会重新提取 63 块）

### Run 3（resumeFromRunId=run-mvaoty1s-1）

- 提取 63 块全部跳过（断点续跑生效）→ Merge Agent 因 journal 回放语义未按新裁决重出 semantic.json
- 处置：单独驱动一次 Merge Agent 按裁决重写 semantic.json（冲突条目 status=resolved + 裁决摘要）
- 确定性验证：`merge-claims.mjs --expect ok` 通过：**329 SRC 写入 source-map.json（去重 36 组、无未解决冲突）**

### Run 4（resume 续跑至 Gate A）

- 容量门禁通过（此前已验证：Claim 325/400、oversize 0/0、tokens 20590/300000）
- Gate A 逐块审查进行中（完成 3/63）→ 用户暂停，进程已终止

## 三、发现的真实缺陷与修复（端到端实测价值）

| # | 缺陷 | 根因 | 修复 | 状态 |
|---|------|------|------|------|
| 1 | sdd-feature.js Claim Merge prompt 嵌套模板语法错误（`${round > 1 && \`...\` : ''}` 为非法表达式），VM 直接拒绝执行 | HEAD 源码笔误；确定性测试未覆盖 workflow 脚本本体解析 | Main Agent 自行修正为三元 `? :`（已入工作区） | 已修复，待提交 |
| 2 | prd-chunker.mjs 在 specs/<feature> 目录不存在时 ENOENT | writeFileSync 前无 mkdirSync | Main Agent 补 `mkdirSync(resolve('specs', feature), { recursive: true })`（已入工作区） | 已修复，待提交 |
| 3 | workflow 无断点续跑：重跑会重新提取全部 63 块（约 2 小时） | 提取与审查循环无幂等短路 | 两处循环加校验器短路（claims 通过则跳过提取；review pass/fix 合法则跳过审查）；Run 3/4 实证生效 | 已修复（工作区），建议提交 |
| 4 | 网关间歇性 `direct model access is not allowed`（OpenCode 层模型路由错误） | 网关把 official 后缀映射到模型组 deepseek-flash；计量/限流瞬时触发 | 网关直连验证恢复正常后重跑成功；未做代码级修复（建议后续 workflow 对 agent 失败加重试上限内的退避重试） | 观察确认，暂不处理 |
| 5 | CLI 驱动下后台链（DevJob）被进程退出中断（"插件重启时被中断"） | 已知坑（Schedule P1 同款） | 验收 prompt 全部带轮询保活指令 | 已规避 |
| 6 | resume 后 Merge Agent 被回放，未按新裁决重出 semantic.json | journal 回放语义：prompt 未变即回放（裁决在文件里，不在 prompt 里） | 单独驱动一次 Merge Agent 重写 semantic.json 后确定性工具通过 | 流程性规避（需求层面可评估"裁决文件内容进 prompt hash"） |

> 上述 1/2/3 是"真实 LLM 链路端到端测试"的直接产出：确定性回归 77/77 无法暴露的集成缺陷。

## 四、T6 各项当前状态

| 测试 | 状态 | 说明 |
|------|------|------|
| T6.1 端到端 | **进行中 ~60%** | 切块 ✓（63 块）→ 提取 ✓（63/63，329 SRC 去重 36 组）→ 合并裁决 ✓ → 容量门禁 ✓（325/400、tokens 20590/300000）→ **Gate A 审查 3/63 中断** → Specify/后续 EARS 链/收敛 未开始；SRC 抽查 10 条未做 |
| T6.2 漏提注入 | 未开始 | 依赖 T6.1 reviews 完成；命令：删一条 claim 后 `node sdd/tools/aggregate-intake-review.mjs lprd-manual-1 --expect fix` |
| T6.3 跨章节冲突 | **机制已被实证**（提前触发） | 干净版 PRD 的 2 处真实笔误被 Merge Agent 检出登记 unresolved + 终止 + 提示裁决；裁决文件已写（conflict-decisions.md）且确定性合并通过。剩余验证：conflict 版 PRD（99/999）走一遍 + checkpoint ask 语义（当前为 allow 预授权） |
| T6.4 容量阻断 | 门禁正向已验证（325/400 通过、错误含阈值与建议的阻断分支未触发） | 待做：maxClaims 临时调小于 Claim 数重跑，验证阻断分支与中间产物保留 |
| T6.5 短模式零回归 | 未开始 | goal-only login 冒烟（不产生 intake/） |
| T6.6 成本统计 | 部分数据已有 | 提取阶段：63 agent；Run 报告 `intake/run-report.json` 未生成（runreport=0）；完成后对比短模式 |

## 五、恢复指引（下次继续）

1. **环境检查**：模型可用（`opencode run -m biangfeng-gateway/deepseek-v4.1-flash-official '回复正常'`）；checkpoint 保持 allow。
2. **续跑 T6.1 Gate A**（断点续跑已生效，reviews 已有 3 块）：

   ```
   cd E:\WorkProjects\spec-kit-workflow
   nohup opencode run -m biangfeng-gateway/deepseek-v4.1-flash-official '调用 workflow 工具，参数：scriptPath: ".opencode-workflows/workflows/sdd-feature.js", args: { feature: "lprd-manual-1", prdPath: "dev-examples/lprd-manual/prd-clean.md", resumeFromRunId: "run-mvaoty1s-1" }。语义合并已通过（329 SRC），Gate A 从断点继续。执行完成后报告最终摘要。' > t61-run5.log 2>&1 &
   ```

   预计 Gate A 剩余 60 块 × ~80s ≈ 80 分钟，之后进入 Specify/后续链路。全程 `./t6-status.sh` 轮询。
3. **T6.1 收尾检查**：收敛后抽查 10 条 SRC 的 sourceRef 行号与 quote 在 source-prd.md 逐字可验证；查看 run-report.json。
4. **T6.2**：删除某 claims 文件中的一条 Claim（保留 reviews）→ `node sdd/tools/aggregate-intake-review.mjs lprd-manual-1 --expect fix` 预期退出 0。
5. **T6.3**：恢复 `workflow-checkpoint:*: ask`；用 prd-conflict.md（99/999）以新 feature 名（lprd-manual-3）跑，验证 checkpoint 弹出/即败 + 手写 conflict-decisions.md 后第二轮合并通过。
6. **T6.4**：`sdd/config.json` largePrd.maxClaims 临时改小（如 100）→ 新 feature 重跑，预期门禁失败终止且 intake/ 保留、错误含阈值与建议；**改回 400**。
7. **T6.5**：goal-only login 冒烟（同 T2.1 缩小版），断言不产生 intake/ 目录。
8. **T6.6**：汇总 run-report.json（块数/Claim 总数/去重组/冲突数/审查轮次）对比短模式。
9. **提交建议**：当前工作区的 Agent 修复（sdd-feature.js 三元语法、prd-chunker mkdirSync）、断点续跑短路、执行报告、PRD 生成器与样本一并提交（第三方评审已确认"无须重复提交"指 LPRD-P0~P3 已推送内容；本轮新增为 T6 执行产物与 bug 修复）。

## 六、当前工作区状态（暂停快照）

- specs/lprd-manual-1/：intake 完整中间产物（chunks 63、claims 63、reviews 3、manifest、source-prd.md、semantic.json(resolved)、merge-report.json、source-map.json(329 SRC)、conflict-decisions.md）
- 工作区修改（未提交）：`.opencode-workflows/workflows/sdd-feature.js`（三元修复+断点续跑）、`sdd/tools/prd-chunker.mjs`（mkdirSync）、`sdd/config.json`（feature 注册）、`opencode.json`（checkpoint allow）、新增 `dev-examples/lprd-manual/`（生成器+两份 PRD+app 占位）、`t6-status.sh`、`t61-run*.log`
- 后台 opencode 进程已全部终止（taskkill 确认 0）
- thirdparties/opencode-dynamic-workflows 显示 M（junction 内 opencode-dynamic-workflows 仓库的改动传导，未在本仓库提交范围）
