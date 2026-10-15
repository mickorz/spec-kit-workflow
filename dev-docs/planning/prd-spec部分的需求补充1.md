找到了：[MicTx/spec-harness](https://github.com/MicTx/spec-harness)。

结论：它确实实现了“原始需求 → 规范化 Spec”的流程，而且在需求澄清、范围控制、假设管理和 Spec 就绪校验方面，比你目前 `spec-kit-workflow` 的 Specify 阶段更完整。

不过，它的核心不是一个独立的“需求转换算法”，而是 Skill 指令 + Spec 模板 + Python 确定性检查器 的组合。

## 一、最值得参考的三个入口

| 入口                                                                                                | 作用                   | 对你的价值        |
| ------------------------------------------------------------------------------------------------- | -------------------- | ------------ |
| [`/spec:new`](https://github.com/MicTx/spec-harness/blob/main/references/stages/new.md)           | 澄清用户需求，创建规范化任务包      | 最直接的参考       |
| [`/spec:autoplan`](https://github.com/MicTx/spec-harness/blob/main/references/stages/autoplan.md) | 多轮澄清，建立项目级规划，进行一致性复核 | 适合复杂游戏系统 PRD |
| [`/spec:goal`](https://github.com/MicTx/spec-harness/blob/main/references/stages/goal.md)         | 从一句目标直接触发规划、实施和验证    | 适合简单需求的一键开发  |

它们不是三个互不相关的实现，而是不同复杂度的入口。

### `/spec:new`：最接近你想要的 `sdd.intake()`

源码明确要求先澄清：

- 项目目标、目标用户和 MVP。
- 技术偏好、需求边界及排除项。
- 已确认事实、关键假设、待确认问题、可选解释和方案取舍。

然后创建 `spec.md` 和 `tasks.md`，为任务定义修改边界与验证方式。

### `/spec:autoplan`：复杂需求先澄清再拆分

它最多进行 5 轮默认主题式提问，按以下顺序：

`目标/用户/价值 → 范围/MVP → 技术/数据/架构 → 优先级/依赖 → 风险/验收`

之后不是立即编码，而是进行框架规划、阶段细化和独立一致性审查，再通过就绪门禁。

这部分特别值得你参考。 因为你最终不是只处理一句“增加登录功能”，还会处理包含客户端、服务端、UI、配置和协议的复杂系统需求。

## 二、它的 Spec 模板比你目前的更重视“需求决策”

我读取了 [`references/templates.md`](https://github.com/MicTx/spec-harness/blob/main/references/templates.md)。

它生成的 `spec.md` 主要包含：

| 章节           | 要解决的问题                  |
| ------------ | ----------------------- |
| 1. 问题定义      | 为什么开发、目标用户是谁、核心价值是什么    |
| 2. 假设与待确认    | 哪些事实已确认、哪些只是推测、哪些问题尚未决定 |
| 3. 功能范围      | MVP、扩展功能、本轮明确不做什么       |
| 4. 最小实现路径    | 本轮采用什么最简单的实现方案          |
| 5. 技术决策      | 技术栈、可修改范围、验证策略          |
| 6. 成功标准与验证方式 | 怎样证明功能真正完成              |
| 7. 风险与约束     | 风险和缓解措施                 |

特别值得借鉴的是它区分了三类信息：

```
### 已确认事实
- 用户必须登录后才能访问背包。

### 关键假设
- 背包默认有 30 个格子，等待产品确认。

### 待确认问题
- [ ] 背包满时，是否允许部分添加物品？
- [ ] 物品的最大堆叠数量是多少？
```

这比把所有内容都交给 LLM 直接生成 FR/AC 更可控。

关键原则：假设不能伪装成已确认需求，未决定的重要行为不能直接进入代码开发。

## 三、它不仅有 Prompt，还实现了真正的校验代码

这一点是我认为最值得参考的地方。

1\. `clarification_gaps()` — 检查 Spec 是否真正完成澄清

[spec_package_support.py，第 1169 行](https://github.com/MicTx/spec-harness/blob/main/scripts/spec_package_support.py#L1169)

它会校验项目目标、目标用户、核心价值，以及已确认事实、关键假设、范围外内容和待确认问题等区块是否有效，而不只是检查文件存在。

2\. `extract_pending_questions()` — 识别尚未关闭的问题

[spec_package_support.py，第 1140 行](https://github.com/MicTx/spec-harness/blob/main/scripts/spec_package_support.py#L1140)

新版 Spec 采用 checkbox 表示问题状态。未解决的问题会被识别出来，不会因为生成了文档就自动视为已确认。

3\. `check_spec_package.py` — 确定性就绪门禁

[check_spec_package.py，第 343～504 行](https://github.com/MicTx/spec-harness/blob/main/scripts/check_spec_package.py#L343-L504)

其中 `assumptions_ok` 的实际逻辑会拒绝澄清缺口、未关闭的问题及缺少范围外定义的 Spec。这种门禁可以直接作为你设计 `sdd.analyze()` 的参考。

值得注意的是，这些检查主要是结构与状态检查，并不能证明需求语义一定正确。

## 四、它没有完全解决你想要的“原始需求无遗漏转换”

这里需要区分两件事。

| 需求能力                 | Spec Harness | 你的目标           |
| -------------------- | ------------ | -------------- |
| 一句话目标 → Spec         | 支持           | 支持             |
| 多轮需求澄清               | 支持           | 应新增            |
| 事实、假设、待确认问题          | 支持           | 应新增            |
| Spec 结构完整性 Gate      | 支持           | 应借鉴            |
| FR / AC / NFR 稳定 ID  | 模板未采用该体系     | 现有 Specify 已支持 |
| 现有 PRD 逐条提取          | 未看到专用的完整转换器  | 需要             |
| 原始需求 ID → Spec ID 映射 | 未看到明确实现      | 建议重点新增         |
| 原始需求覆盖率 Gate         | 未看到独立实现      | 建议重点新增         |

Spec Harness 主要使用范围、成功标准和任务验证来组织 Spec；你的项目则已经建立了 FR、AC、NFR 和 Code Evidence 体系。

所以不建议直接替换你现有的 `spec.md` 模板。

更合适的办法是：保留你现有的 FR/AC/NFR 契约，吸收 Spec Harness 的 Intake、Clarification 和 Readiness Gate。

## 五、我建议最终形成的需求转换架构

原始输入

自然语言 / PRD Markdown / 需求文档

sdd.intake()

拆分原始需求，分配 SRC-ID，记录来源

sdd.clarify()

事实 / 假设 / 冲突 / 待确认问题 / 范围

sdd.specify()

正式生成 FR / AC / NFR 规格文档

sdd.analyzeSourceCoverage()

检查每条 SRC 是否覆盖、排除或待确认

经过验证的 spec.md

进入 Plan → Tasks → Implement → Review

例如，你输入一份背包系统原始需求，第一步先生成：

```
{
  "requirements": [
    {
      "id": "SRC-001",
      "text": "背包中的相同物品可以堆叠",
      "source": "背包系统PRD.md",
      "status": "confirmed"
    },
    {
      "id": "SRC-002",
      "text": "背包满时无法添加物品",
      "source": "背包系统PRD.md",
      "status": "confirmed"
    }
  ]
}
```

再生成 Spec，并记录来源映射：

```
{
  "mappings": [
    {
      "sourceId": "SRC-001",
      "requirementIds": ["FR-001"],
      "acceptanceIds": ["AC-001", "AC-002"],
      "disposition": "covered"
    },
    {
      "sourceId": "SRC-002",
      "requirementIds": ["FR-002"],
      "acceptanceIds": ["AC-003"],
      "disposition": "covered"
    }
  ]
}
```

以上是我建议的扩展设计，不是 Spec Harness 已经提供的数据格式。

对于每条 SRC，还应允许明确的 `excluded` 或 `pending` 结果，但排除需要理由，不能静默丢失。

这样才能构建你最初想要的全链路：

`Source → FR/AC/NFR → Tasks → Code → Test Evidence`

## 六、应该从 Spec Harness 借鉴哪些部分？

我建议按下面的优先级：

| 优先级 | 借鉴设计                          | 对应你的 API                               |
| --- | ----------------------------- | -------------------------------------- |
| P0  | `/spec:new` 的需求澄清规则           | `sdd.intake()`                         |
| P0  | 事实、假设、待确认问题结构                 | `sdd.clarify()`                        |
| P0  | `clarification_gaps()` 的确定性校验 | `sdd.analyze()`                        |
| P0  | 待确认问题未关闭的阻断规则                 | `sdd.approve()`                        |
| P1  | `/spec:autoplan` 的多轮主题式澄清     | `sdd.clarify({ mode: 'interactive' })` |
| P1  | 框架规划 → 细节规划 → 一致性审查           | 复杂需求规划工作流                              |

同时，需要特别注意它的 [PolyForm Noncommercial 许可证](https://github.com/MicTx/spec-harness/blob/main/LICENSE)。可以研究并借鉴设计思想，但不要未经许可证核实就直接把实现代码复制进你计划公开发布的 npm 插件。

## 七、最终建议

我认为这次调研确认了一件很重要的事：

`sdd.feature()` 的第一阶段不应该只有 Specify，而应该有完整的 Requirement Intake 流程。

未来调用方式建议是：

```
const result = await sdd.feature({
  goal: args.goal,
  sources: args.documents,
  projectPath: args.projectPath,
  specDir: args.specDir,
  clarify: {
    mode: 'interactive',
    blockOnCriticalQuestions: true
  },
  maxRounds: 3
})
```

它内部执行：

`Intake → Clarify → Specify → Source Coverage Gate → Plan → Tasks → Analyze → Approve → Implement → Evidence → Review → Converge`

这比单纯在 Specify Prompt 上增加几句话更可靠。

我的建议是把 Spec Harness 的需求澄清与就绪机制作为参考，把你自己已有的 FR/AC/NFR 追踪与 Spec ↔ Code 审计作为核心，两者结合。

这样未来不仅能检查“Spec 有没有真正实现到 Code”，还能进一步检查最前面的关键问题：

“用户的原始需求，有没有被完整、准确地转成 Spec？”