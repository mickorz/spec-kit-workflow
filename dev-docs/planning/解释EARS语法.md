**You:**

[https://github.com/gotalab/cc-sdd](https://github.com/gotalab/cc-sdd) 给我解释一下Easy Approach to Requirements Syntax，这个是什么，怎么做到的

* * *

**ChatGPT:**

# EARS 是什么？cc-sdd 如何利用它生成规范的需求？

我查看了 [gotalab/cc-sdd](https://github.com/gotalab/cc-sdd) 的源码，包括 `ears-format.md`、`kiro-spec-requirements` Skill、需求模板以及 Requirements Review Gate。

先说结论：

EARS（Easy Approach to Requirements Syntax，简易需求语法）是一套标准化描述软件需求的方法。它把模糊的自然语言需求转换成具有明确触发条件、执行主体和预期行为的结构化需求。

它不是编程语言，也不是一种新的 AI 模型，而是一种需求工程规范。

cc-sdd 则通过 LLM + EARS 规则 + 文档模板 + 质量审查，让 AI 自动生成符合这种规范的 `requirements.md`。

## 一、为什么需要 EARS？

假设你正在开发游戏登录功能，策划给出原始需求：

> 玩家登录失败后，需要提示错误。如果网络断了，应该支持重新连接。登录过程中不能重复点击登录按钮。

这段话对人类来说很容易理解，但对于 AI Coding Agent，存在一些问题：

* 登录失败包括哪些情况？
* 提示什么错误？
* 网络断开后自动重连还是手动重试？
* 重连多少次？
* 登录按钮什么时候恢复？

如果直接把这样的需求交给 Agent 开发，AI 很可能自行补充业务规则，而不同 Agent 的理解可能不一致。

EARS 的作用就是把需求变成可验证的行为契约。

例如：

```
### Requirement 1: 玩家登录

#### Acceptance Criteria

1. When 玩家点击登录按钮,
   the 登录系统 shall 发起登录请求。

2. While 登录请求正在处理,
   the 登录界面 shall 禁止重复提交。

3. If 登录请求返回账号不存在,
   the 登录界面 shall 显示账号不存在提示。

4. If 登录过程中网络连接断开,
   the 登录系统 shall 进入连接失败状态。

5. When 玩家在连接失败状态下点击重试,
   the 登录系统 shall 再次发起登录请求。
```

注意：这些是根据原始描述演示的需求拆分，不代表所有业务规则都已经确定。

这样修改后，每条需求都包含了明确的触发条件以及预期结果，也就更容易转化成自动化测试。

## 二、EARS 的五种核心语法

cc-sdd 在 `ears-format.md` 里面定义了五种基本模式。

|   类型   |   语法结构   |   使用场景   |
| --- | --- | --- |
|   Event-driven 事件驱动   |   `When ... shall ...`   |   点击、收到消息、触发事件   |
|   State-driven 状态驱动   |   `While ... shall ...`   |   加载中、战斗中、断线中   |
|   Unwanted behavior 异常处理   |   `If ... shall ...`   |   登录失败、超时、数据错误   |
|   Optional feature 可选功能   |   `Where ... shall ...`   |   功能开启、特定版本、配置启用   |
|   Ubiquitous 始终有效   |   `The system shall ...`   |   通用约束、性能、安全规则   |

例如，游戏战斗系统里可以这样使用：

事件驱动：

```
When 玩家释放技能,
the 战斗系统 shall 扣除对应魔法值。
```

状态驱动：

```
While 玩家处于眩晕状态,
the 战斗系统 shall 禁止玩家释放技能。
```

异常处理：

```
If 玩家魔法值不足,
the 战斗系统 shall 拒绝释放技能。
```

可选功能：

```
Where 自动战斗功能已开启,
the 战斗系统 shall 根据自动战斗规则选择技能。
```

始终有效：

```
The 战斗系统 shall 保证角色当前生命值不小于零。
```

还可以组合使用：

```
While 玩家处于战斗状态,
when 玩家生命值降至零,
the 战斗系统 shall 将玩家状态切换为死亡。
```

cc-sdd 的规则还要求每条需求描述尽量只包含一个可验证行为，并通过 `shall` 表达强制性的系统行为。

源码：[ears-format.md](https://github.com/gotalab/cc-sdd/blob/main/.kiro/settings/rules/ears-format.md)

## 三、cc-sdd 具体怎么实现的？

它的核心不是编写一个复杂的自然语言解析器，而是采用 规则驱动生成 + 模板约束 + Review Gate。

cc-sdd 需求生成流程

用户自然语言 / PRD

例如：开发一个游戏登录系统

Discovery + 上下文收集

明确范围、读取项目规则、现有需求

EARS Rules

控制语法与表述

Requirements Template

控制文档结构

LLM 生成需求草稿

按功能域拆分成编号的 EARS 验收标准

Requirements Review Gate

语法、可测试性、需求覆盖、歧义检查

不通过 → 修复重审（最多两轮）

requirements.md

输出正式需求，等待人工批准

### 1. EARS 规则文件

路径：

[`tools/cc-sdd/templates/shared/settings/rules/ears-format.md`](https://github.com/gotalab/cc-sdd/blob/main/tools/cc-sdd/templates/shared/settings/rules/ears-format.md)

这个文件定义了五种 EARS 句式、组合句式、执行主体的选择规范以及质量标准。

例如，它规定需求必须可以测试、可以验证，并尽量描述单一行为。

### 2. 文档模板文件

路径：

[`.kiro/settings/templates/specs/requirements.md`](https://github.com/gotalab/cc-sdd/blob/main/.kiro/settings/templates/specs/requirements.md)

它规定最终文档应该长什么样：

```
# Requirements Document

## Introduction
{{INTRODUCTION}}

## Requirements

### Requirement 1: {{REQUIREMENT_AREA}}

**Objective:**
As a {{ROLE}},
I want {{CAPABILITY}},
so that {{BENEFIT}}

#### Acceptance Criteria

1. When [event], the [system] shall [action]
2. If [trigger], then the [system] shall [action]
3. While [condition], the [system] shall [action]
```

这里结合了两种东西：

**User Story（用户故事）**用于说明谁需要什么、为什么需要；EARS 则负责定义系统具体应该表现出什么行为。

### 3. Skill 负责执行生成

当前 v3 的 OpenCode Skills 路径：

[`kiro-spec-requirements/SKILL.md`](https://github.com/gotalab/cc-sdd/blob/main/tools/cc-sdd/templates/agents/opencode-skills/skills/kiro-spec-requirements/SKILL.md)

这个 Skill 指示 Agent 读取原始需求、项目上下文和 EARS 规则，生成草稿并调用需求审查规则。

关键是：EARS 规则定义“应该怎么写”，Skill 定义“什么时候读取规则、怎么生成、怎么检查”。

### 4. Requirements Review Gate

路径：

[`requirements-review-gate.md`](https://github.com/gotalab/cc-sdd/blob/main/.kiro/settings/rules/requirements-review-gate.md)

这是当前实现值得关注的部分。

它要求检查：

|   检查维度   |   具体内容   |
| --- | --- |
|   语法合规   |   是否符合 EARS 格式   |
|   完整性   |   是否覆盖核心流程、异常、边界   |
|   可测试性   |   行为是否明确、可观察、可验证   |
|   一致性   |   是否出现需求重复或矛盾   |
|   编号规范   |   Requirement ID 是否符合要求   |
|   WHAT / HOW   |   是否把具体技术实现混入需求   |

草稿不符合要求时，Agent 应尝试修复并重新审查，最多两轮。如果存在真正的业务歧义，需要返回让用户确认，不能随意猜测。

但要特别注意：这个 Review Gate 主要是通过 Skill 指令让 LLM 执行的检查，并不等于已经拥有严格的、可证明正确的 EARS 语法解析器。 检查效果仍然受模型执行质量影响。

## 四、EARS 是否能够防止遗漏需求？

这是我认为需要区分的重点。

EARS 的主要价值是提升已识别需求的表达质量，而不是自动发现所有遗漏需求。

|   问题   |   EARS 能否解决   |
| --- | --- |
|   需求表述模糊   |   明显改善   |
|   缺少触发条件   |   容易暴露   |
|   预期行为不清楚   |   容易暴露   |
|   一个句子混合多个要求   |   有助于拆分   |
|   原始 PRD 漏写功能   |   不能保证发现   |
|   原始 PRD 存在业务矛盾   |   需要额外分析   |
|   代码没有实现某项需求   |   需要测试和实现审计   |

举个例子，PRD 完全没有提到账号被封禁后应该如何登录，EARS 不会凭空知道正确的封禁业务规则。

它可以帮助 AI 发现“这里似乎缺少一个异常分支”，但最终还是要结合业务知识、现有代码以及人工确认。

## 五、对于你的 SDD Workflow，有什么借鉴价值？

我建议把 EARS 放到 PRD → Spec 的规范化转换阶段，而不是直接放到代码生成阶段。

```
原始 PRD
   ↓
需求点提取
   ↓
遗漏 / 矛盾 / 歧义分析
   ↓
EARS 规范化
   ↓
requirements.md
   ↓
Spec 审核与批准
   ↓
Design → Tasks → Implementation
   ↓
按 Requirement ID 验收
```

如果集成进你的 `opencode-dynamicworkflows`，可以借鉴 cc-sdd 的 EARS 规则文件和模板，但把检测分成两层：用 `check()` 确定性检查编号、结构、句式等，用 `verify()` 让 LLM 判断语义正确性、业务覆盖程度和可测试性。

这样 EARS 不仅是文档的写法，还可以成为从原始需求一直追溯到测试结果的统一行为规范。

补充一点：EARS 并不是 cc-sdd 发明的。它由 Alistair Mavin 等人在 Rolls-Royce 开发，并于 2009 年正式发表，最初用于提高复杂工程系统需求的准确性。

Official Guide

+1

原始方法介绍：[EARS 官方说明](https://alistairmavin.com/ears/)

最终我建议你借鉴的不是单独的 EARS 句式，而是 cc-sdd 的「EARS + Requirements Review Gate + Requirement ID 追踪」组合。 这比单纯让 AI 把 PRD 改写成规范格式，对后续自动开发和防漏验收更有价值。

* * *

**You:**

我的理解就是 ears 是把 原始需求prd 转成 ai更能读懂的 requirement 对吗

* * *

**ChatGPT:**

对，你的理解基本正确，但需要区分两个概念：

* EARS：是一种标准化的需求描述语法，让需求更明确、结构化、可测试，方便 AI 和人类理解。
* cc-sdd：利用 LLM + EARS 规则，把原始 PRD 转换为结构化的 `requirements.md`。

整个过程可以理解为：

```
原始 PRD（自然语言）
       ↓
   LLM 提取需求点
       ↓
   EARS 语法规范化
       ↓
requirements.md
       ↓
   AI 生成 Design
       ↓
   AI 拆分 Tasks
       ↓
   AI 编写代码和测试
```

### 举个例子

原始 PRD：

> 玩家点击登录按钮进行登录。登录失败时显示错误提示，登录过程中不能重复点击。

转换成 EARS Requirements：

```
### Requirement 1: 玩家登录

#### Acceptance Criteria

1. When 玩家点击登录按钮,
   the 登录系统 shall 发起登录请求。

2. While 登录请求正在处理,
   the 登录界面 shall 禁止重复提交。

3. If 登录请求失败,
   the 登录界面 shall 显示对应错误信息。
```

这样 AI 就更容易知道：

* When / While / If：什么条件下执行。
* System：哪个系统负责。
* Shall：必须实现什么行为。

而且每条 Requirement 可以进一步关联代码和测试用例。

### 还有一个非常重要的区别

EARS 解决的是需求表达规范化，不是需求完整性。

例如，原始 PRD 漏掉了「登录超时」的处理，EARS 本身不会自动补出这个需求。

因此，如果你希望实现完整的 PRD → Spec 转换，我更推荐：

PRD → 需求点提取 → 完整性/歧义分析 → EARS 标准化 → requirements.md → 审核

这也是你的 SDD Workflow 应当重点考虑的地方：先保证需求不遗漏，再保证需求表达清楚，最后保证每一条需求都能被实现和验收。

* * *

**You:**

他其实是不管 requirement 到 spec阶段如何的对吗

* * *

**ChatGPT:**

对，如果你说的是 EARS，那么理解完全正确。

EARS 只负责规范 Requirement 的表达方式，不负责 Requirement → Spec 的后续转换。

但需要区分 EARS 和 cc-sdd：

|   阶段   |   EARS   |   cc-sdd   |
| --- | --- | --- |
|   PRD → 需求提取   |   不负责   |   LLM 辅助   |
|   需求 → EARS Requirements   |   提供语法规范   |   负责生成   |
|   Requirements → Design   |   不负责   |   支持   |
|   Design → Tasks   |   不负责   |   支持   |
|   Tasks → Code   |   不负责   |   支持   |
|   Code → 验收   |   不负责   |   支持实现审查   |

实际上，在 cc-sdd 中，`requirements.md` 已经是 Spec 的一部分。

它的流程是：

```
原始 PRD
    ↓
需求提取、分析
    ↓
requirements.md  ← EARS 作用在这里
    ↓
design.md
    ↓
tasks.md
    ↓
Implementation
    ↓
Validation
```

这里还有一个关键区别：

* EARS：解决需求怎么描述，才能准确、可测试。
* Spec-Driven Development：解决如何把需求转化成设计、开发任务、代码和验收结果。
* 需求完整性审计：解决原始 PRD 中的需求有没有被遗漏、误解或错误扩展。

所以，对你的 `opencode-dynamicworkflows` 而言，EARS 可以作为 Requirements 生成阶段的一套规则引入，不需要为它单独设计一套完整的 Workflow。

而你之前关注的 PRD → Requirements → Spec → Code 的全链路防漏需求，仍然需要额外的需求追踪和覆盖率审计机制。

* * *

**You:**

requirements.md 已经是 Spec 的一部分 是什么意思，Spec还包含了什么

* * *

**ChatGPT:**

在 cc-sdd 中，Spec（Specification，规格说明）不是单独一份 `spec.md` 文件，而是一组描述某个功能的规范文档。

它主要由三部分组成：

1. `requirements.md`：要实现什么（WHAT）
2. `design.md`：准备怎么实现（HOW）
3. `tasks.md`：具体拆分成哪些开发任务（TODO）

可以理解为：

Requirement 是需求规范，Spec 是包含需求、设计和实施计划的完整规格包。

## 一、cc-sdd 的 Spec 结构

以开发游戏登录系统为例：

```
.kiro/
└── specs/
    └── game-login/
        ├── spec.json         # 元数据、状态
        ├── brief.md          # 初步需求与范围（可选）
        ├── requirements.md   # 需求规范
        ├── design.md         # 技术设计
        ├── tasks.md          # 开发任务
        └── research.md       # 技术调研（可选）
```

其中最核心的是 `requirements.md`、`design.md`、`tasks.md`。

|   文件   |   主要内容   |   回答什么问题   |
| --- | --- | --- |
|   `requirements.md`   |   功能行为、业务规则、异常处理、验收条件   |   系统必须做什么？   |
|   `design.md`   |   模块划分、系统架构、接口、数据结构   |   系统如何实现？   |
|   `tasks.md`   |   任务步骤、依赖关系、Requirement ID   |   开发人员或 Agent 应该做哪些任务？   |
|   `spec.json`   |   Spec 状态、语言、审批信息   |   目前进行到哪个阶段？   |
|   `brief.md`   |   初始问题、目标、范围与约束   |   为什么做、做多大？   |
|   `research.md`   |   技术调研、可行性、设计依据   |   技术方案有什么依据？   |

## 二、举个完整例子：游戏登录功能

### 1. Requirements：定义需求

```
# Requirement 1: 玩家登录

1.1 When 玩家点击登录按钮,
    the 登录系统 shall 发起登录请求。

1.2 While 登录请求正在处理,
    the 登录系统 shall 禁止重复登录。

1.3 If 登录请求失败,
    the 登录系统 shall 显示错误信息。
```

只描述必须实现的行为，不指定用什么技术。

### 2. Design：定义技术方案

```
# 登录系统技术设计

## 客户端
- LoginController：处理登录状态
- LoginView：管理登录 UI

## 服务端
- AuthService：验证账号
- SessionService：管理会话

## 网络协议
- LoginRequest
- LoginResponse

## Requirement Mapping
- 1.1 → LoginController + AuthService
- 1.2 → LoginController + LoginView
- 1.3 → LoginController + LoginView
```

这里才开始定义代码架构、模块职责、接口、状态和数据模型。

cc-sdd 的 `design.md` 还支持 File Structure Plan（文件结构规划）、系统流程、组件接口和需求追踪映射。

GitHub

### 3. Tasks：定义实现步骤

```
# 登录开发任务

Task 1: 实现 LoginRequest/LoginResponse
Task 2: 实现服务端 AuthService
Task 3: 实现客户端 LoginController
Task 4: 实现 LoginView
Task 5: 编写登录验收测试

Requirement Mapping:
- Task 2 → 1.1
- Task 3 → 1.1, 1.2, 1.3
- Task 4 → 1.2, 1.3
- Task 5 → 1.1, 1.2, 1.3
```

每个 Task 都可以反向关联 Requirement。

## 三、最重要的是它们之间的追踪关系

PRD：玩家登录功能

原始业务需求

Requirements

WHAT

REQ-1.1：点击登录发起请求

REQ-1.2：禁止重复登录

REQ-1.3：失败显示错误

Design

HOW

LoginController、LoginView、AuthService

设计内容关联对应 REQ ID

Tasks

TODO

Task 1、Task 2、Task 3...

每个 Task 标明要覆盖的 REQ ID

Code + Tests + Validation

按 Requirement ID 检查最终实现

这个关系是 cc-sdd 的核心设计之一。它将一个 Spec 视作可以独立设计、交付和重新验证的功能单元。

GitHub

## 四、与传统 PRD 的区别

|   对比   |   PRD   |   Spec（cc-sdd）   |
| --- | --- | --- |
|   核心目的   |   描述产品需求   |   指导开发和验收   |
|   主要读者   |   策划、产品、研发   |   开发人员、AI Agent、测试   |
|   详细程度   |   业务层面   |   行为 + 技术设计 + 任务   |
|   是否包含技术架构   |   通常不要求   |   是   |
|   是否包含任务拆分   |   通常不要求   |   是   |
|   是否支持需求追踪   |   不一定   |   通过 Requirement ID 关联   |

还有一点：Spec 并没有业界统一规定必须包含哪几个文件。 `requirements.md + design.md + tasks.md` 是 cc-sdd 采用的组织方式，而其他 SDD 框架可能使用 `spec.md + plan.md + tasks.md`。

对你目前在研究的 PRD → Spec 工作流来说，可以把整条链路理解为：

PRD 是输入，Requirements 是经过规范化的需求契约，Design 和 Tasks 是让需求能够被实现的后续规格，Code 和 Tests 是最终交付与验证。

EARS 只作用于其中的 Requirements 表达层，而 cc-sdd 负责整个 Spec 的生成与执行流程。

* * *

**You:**

https://github.com/mickorz/spec-kit-workflow.git  我想在这个项目引入ears

* * *

**ChatGPT:**

# spec-kit-workflow 引入 EARS：架构分析与集成方案

我检查了你当前的 [mickorz/spec-kit-workflow](https://github.com/mickorz/spec-kit-workflow) 的 `master` 分支，以及 cc-sdd 的 EARS 实现。

我的建议是：直接把 EARS 集成进现有的 Specify 阶段，不新建一套独立的 Requirements → Spec 流程，也不改变你已经建立的 FR / AC / NFR 追踪机制。

因为你的项目目前已经具备：

* `sdd-feature.js`：Specify → Plan → Tasks → Analyze → Implement → Review → Converge 的开发流程。
* `spec.md`：作为需求的权威来源。
* `FR-001`、`AC-001`、`NFR-001`：稳定需求 ID。
* `traceability.json`：需求与任务映射。
* `coverage.mjs`：需求 ID 覆盖率检查。
* `review.json`：实现结果的逐项语义审查。

缺少的不是新的一套 Spec 系统，而是在需求生成后，检查每条验收条件是否足够明确、符合 EARS、可以实际测试。

## 一、EARS 应该放在哪里？

原始 PRD / 用户需求

当前 sdd-feature.js 的 goal 输入

Specify 阶段

引入 EARS

1. 提取 FR / AC / NFR

2. 将验收条件规范化为 EARS 句式

3. EARS 格式与质量审查

4. 生成现有的 `spec.md`

EARS Gate（新增）

不符合规范 → 修复或人工澄清

Plan → Tasks → Analyze

沿用现有的 Requirement ID 追踪

Implement → Review → Converge

按原有 Spec 和验收条件验证实现

这样你原有的开发、覆盖率、审批、基线冻结和收敛逻辑原则上都可以继续使用。

## 二、具体需要修改哪些文件？

根据当前代码，我建议第一版只修改 3 个现有文件，新增 2 个文件。

|   文件   |   操作   |   目的   |
| --- | --- | --- |
|   `sdd/templates/spec.md`   |   修改   |   在现有 AC 结构中加入 EARS 规范   |
|   `sdd/rules/ears-format.md`   |   新增   |   存放可复用的 EARS 语法和质量规则   |
|   `sdd/tools/validate-ears.mjs`   |   新增   |   确定性检查 EARS 格式   |
|   `.opencode-workflows/workflows/sdd-feature.js`   |   修改   |   在 Specify 后增加 EARS Gate   |
|   `sdd/config.json`   |   修改   |   增加 EARS 开关和严格程度配置   |

### 1. 保留现有 spec.md 格式

你现在的模板是：

```
### FR-001: 玩家登录

需求描述。

**验收条件**：
- AC-001: 验收条件描述
- AC-002: 验收条件描述
```

建议改成：

```
### FR-001: 玩家登录

玩家能够通过账号密码登录游戏。

**验收条件**：

- AC-001: When 玩家提交有效账号和正确密码,
  the 登录系统 shall 完成身份验证并创建会话。

- AC-002: If 玩家提交错误密码,
  the 登录系统 shall 拒绝登录并返回认证失败结果。

- AC-003: While 登录请求正在处理,
  the 登录客户端 shall 阻止重复提交。
```

注意，保留 `AC-001`、`AC-002` 等 ID 和 `- AC-001:` 的 Markdown 格式，避免破坏你已有的 `coverage.mjs` 和 `audit-spec-parse.mjs`。

多行验收条件可以作为排版形式，但校验脚本应按完整 AC 块解析，不能假设每条 AC 永远只有一行。

### 2. 引入 cc-sdd 的 EARS 规则

你的 `.gitmodules` 里已经包含：

`thirdparties/cc-sdd`

可以直接参考它的：

[ears-format.md](https://github.com/gotalab/cc-sdd/blob/main/tools/cc-sdd/templates/shared/settings/rules/ears-format.md)

建议提取并维护成项目自己的 `sdd/rules/ears-format.md`，避免每次运行都需要读取第三方仓库。

规则应包括五种 EARS 句式、复合条件、可测试性、一条 AC 描述一个主要行为，以及禁止 AI 擅自补充未经确认的业务数值。

### 3. 修改 Specify Prompt

当前 `sdd-feature.js` 中 Specify Agent 只要求：

JavaScript

```
phase('Specify')

const spec = await agent(
  `依据需求：${goal}
参照 sdd/templates/spec.md 格式。
生成 ${dir}/spec.md。
使用 FR-001、AC-001、NFR-001 等稳定 ID。
覆盖正常流程、异常流程及边界条件。`,
  { label: 'Specify', agentType: 'general' }
)
```

建议增加规则约束：

JavaScript

```
const spec = await agent(
  `依据原始需求：${goal}

读取以下文件：
- sdd/templates/spec.md
- sdd/rules/ears-format.md

要求：
1. 保留 FR/AC/NFR 稳定 ID
2. 每个 FR 必须关联至少一个 AC
3. AC 使用合适的 EARS 句式
4. 每条 AC 只描述一个主要行为
5. AC 必须具备可观察、可验证的结果
6. 不得擅自增加未经确认的业务规则
7. 对无法确定的条件标记待澄清
8. 保留现有 spec.md 文档结构

生成 ${dir}/spec.md。`,
  { label: 'Specify', agentType: 'general' }
)
```

这只是需要修改的关键 Prompt 片段；正式开发时应保留你现有的超时、Agent 权限和 Workflow 约束。

## 三、增加 EARS Gate，而不只是让 AI 按格式输出

这一点很重要。

如果只在 Prompt 里写一句「使用 EARS」，Agent 可能依然生成：

```
- AC-001: 玩家登录成功
```

因为目前 `coverage.mjs` 只负责检查 ID 和映射覆盖，不会识别 AC 是否满足 EARS。

建议新增两层验证：

|   验证层   |   实现方式   |   检查内容   |
| --- | --- | --- |
|   结构检查   |   `check()` + `validate-ears.mjs`   |   AC ID、句式、是否为空、基础语法   |
|   语义检查   |   LLM Reviewer   |   句式是否正确表达需求、行为是否可测试、是否有无依据的规则   |

EARS 的句式检查可以比较确定，但语义质量仍然需要 LLM 判断。

建议在现有 Specify 与 Plan 之间执行：

JavaScript

```
phase('EARS Validation')

await check(
  () => commandSuccess(
    `node sdd/tools/validate-ears.mjs ${feature}`
  ),
  'EARS 格式校验失败'
)
```

这段适合表达 Gate 的位置。完整工作流还需要加入有限的修复重试：校验失败后让 Agent 修复局部问题，再重新执行检查；真正的业务歧义应该交给人工确认。

这样可以复用你现有的 `check()`，不需要为 EARS 新增 Workflow DSL 节点。

## 四、实施优先级

P0 — EARS 格式规范化

增加规则文件、修改 Spec 模板与 Specify Prompt，并加入确定性格式检查。保持 FR / AC / NFR 编号和现有 Artifact 契约不变。

P1 — EARS 语义质量门禁

参考 cc-sdd 的 Requirements Review Gate，加入可测试性、歧义、原始需求一致性检查和有限修复循环。

P2 — PRD → Spec 防遗漏追踪

为原始需求建立 Source ID，检查哪些原始需求被转化为 FR/AC/NFR，哪些被遗漏、错误修改或未经确认地新增。

## 五、现有项目需要特别注意的两个兼容性问题

第一，你已经有很多非 EARS 的历史需求。

例如当前的 [`specs/login/spec.md`](https://github.com/mickorz/spec-kit-workflow/blob/master/specs/login/spec.md) 使用了 `AC-001: 输入已注册...` 这样的自然语言验收条件。

如果直接全局启用严格验证，这些历史 Spec 都会被判定为不合规。

建议提供：

* `off`：不检查 EARS。
* `warn`：报告问题，但不阻断后续流程。
* `enforce`：只有通过 EARS Gate 才能进入 Plan。

新创建的 Spec 默认 `enforce`，历史 Spec 先采用 `warn`。已经批准并冻结的 Spec 不应被自动重写，否则会导致 `specHash` 变化、现有证据失效。

第二，你已有的 Coverage Gate 不负责 PRD 原始需求完整性。

即使一个 Spec 有 20 条 FR，20 条全部通过 Coverage，也只能证明这 20 条有后续任务映射。

不能证明原始 PRD 中的第 21 条没有被漏掉。

因此，EARS Gate 与未来的 Source Coverage Gate 应该分开实现。

## 六、测试建议

你当前仓库有 `specs/login/spec.md` 和配套测试项目，非常适合做 EARS A/B 测试。

建议冻结同一份登录需求输入，分别测试旧 Specify 与 EARS Specify，比较：

|   验收指标   |   目标   |
| --- | --- |
|   FR/AC/NFR ID 兼容   |   100%   |
|   EARS 格式合规   |   100%   |
|   原始需求保留   |   不得遗漏已有明确需求   |
|   无依据业务规则新增   |   0 项   |
|   现有 Coverage Gate   |   必须通过   |
|   原有 Review/Converge   |   不得发生回归   |

其中需求保留和无依据新增需要独立审查或人工构造的标准答案，不能仅靠正则检查。

最终建议：先实现 P0 + P1，让 EARS 成为 `sdd.feature()` 的 Specify 阶段内置规范，而不是新增一个 `requirements.md` 系统。

这样你的整体路线仍然是：

`PRD → Specify（EARS）→ Plan → Tasks → Analyze → Implement → Review → Converge`

后续再增加 P2，才能真正推进你希望实现的「原始 PRD → Spec → Code 全链路防漏需求」能力。

目前以上是基于 GitHub 现有源码形成的设计方案，还没有修改你的仓库或执行测试。

* * *

**You:**

不用管之前的spec.md 兼容问题

* * *

**ChatGPT:**

明白。那我们可以采用 Breaking Change（破坏性升级），直接重新定义 `spec.md` 的格式，不再考虑旧版兼容、历史数据迁移以及 `off / warn / enforce` 三种模式。

我建议采用 EARS 强制规范 + 统一验收条件 + 双层质量门禁 的方案。

## 一、新版 Spec 结构

不额外引入 `requirements.md`，继续让 `spec.md` 作为唯一的需求真相源。

```
# Feature: 游戏登录系统

## 功能需求

### FR-001: 玩家登录

**描述**
玩家可以使用账号密码登录游戏。

**验收条件**

- AC-001: When 玩家提交正确的账号和密码,
  the 登录系统 shall 验证身份并创建登录会话。

- AC-002: If 玩家提交错误密码,
  the 登录系统 shall 拒绝登录并返回认证失败结果。

- AC-003: While 登录请求正在处理,
  the 登录客户端 shall 阻止重复提交。

## 非功能需求

### NFR-001: 登录性能

**验收条件**

- AC-004: The 登录服务 shall 在规定测试负载下
  保证95%的登录请求响应时间不超过500ms。
```

相比之前的版本，做三个改变：

1. FR 和 NFR 都必须有可验证的 AC，不再允许只有描述、没有验收标准。
2. 所有 AC 必须符合 EARS 规范，选用适合的事件、状态、异常或全局约束句式。
3. 每条 AC 尽量表达一个独立可测试行为，并保持全局唯一 ID。

## 二、更新后的 Workflow

原始 PRD / 用户需求

Specify Agent

提取 FR / NFR → 使用 EARS 生成 AC

EARS Quality Gate

新增

确定性语法检查 + LLM 语义审查

不通过则限次修复；无法消除的业务歧义进入人工确认

新版 spec.md

Plan → Tasks → Analyze

Implement → Review → Converge

## 三、需要调整的代码范围

|   文件   |   调整   |
| --- | --- |
|   `sdd/templates/spec.md`   |   重新定义 EARS Spec 模板   |
|   `sdd/rules/ears-format.md`   |   新增 EARS 规则   |
|   `sdd/tools/validate-ears.mjs`   |   新增 EARS 结构校验器   |
|   `sdd-feature.js`   |   修改 Specify，加入 EARS Gate   |
|   `audit-spec-parse.mjs`   |   适配新版 FR/NFR/AC 关系   |
|   `coverage.mjs`   |   强制 FR/NFR 都有 AC   |
|   `validate-review.mjs`   |   校验所有需求的 AC 验证结果   |

另外需要同步检查 `traceability.json` 的生成、`sdd-audit.js` 和收敛判断，确保 NFR 的 AC 也纳入覆盖与验收，不能静默跳过。

## 四、实施顺序

P0：规范落地

* 新 EARS 模板与规则。
* Specify 直接生成规范化 Spec。
* 确定性格式校验。
* 更新相关解析器和 Coverage Gate。
* 跑通一次完整的 `sdd.feature()`。

P1：质量强化

* 引入 cc-sdd 的 Requirements Review Gate。
* LLM 审查需求歧义、单一行为、可测试性。
* 自动修复与有限次数重试。
* 无法确定的业务规则交给人工确认。

P2：需求防漏

* PRD 原始需求提取。
* PRD → FR/NFR/AC 来源映射。
* 识别遗漏、冲突、无依据新增需求。

P2 是增强项，不应让 EARS 集成依赖它才能运行。

最终架构决策：EARS 成为 Spec 格式的强制标准，而不是一个可选能力。 不需要迁移历史 Spec，也不需要额外的兼容模式；直接围绕新版格式更新生成、校验、审计及验收链路。

目前我们仍处于方案设计阶段，没有修改仓库。

* * *

**You:**

给我一个改造需求文档

* * *

**ChatGPT:**

已根据你当前的 [spec-kit-workflow](https://github.com/mickorz/spec-kit-workflow) 源码，编写了 《EARS 强制规范化改造需求文档 v1.0》。

EARS 改造需求文档.md

347 行 · 包含 10 项功能需求、20 项验收测试、分阶段实施规划

下载文档

写作

# spec-kit-workflow EARS 改造需求文档

**版本：** v1.0  
**状态：** 待评审  
**目标项目：** mickorz/spec-kit-workflow  
**改造策略：** Breaking Change，不兼容旧版 Spec

## 一、改造目标

在现有 Spec-Driven Development 工作流中引入 EARS（Easy Approach to Requirements Syntax），将原始自然语言需求转换为标准化、明确、可测试的需求规范。

本次改造遵循以下原则：

1. 保留 `spec.md` 作为唯一需求真相源，不额外创建 `requirements.md`。
2. 所有 FR（功能需求）和 NFR（非功能需求）必须有对应的 AC（验收条件）。
3. 所有 AC 必须使用 EARS 标准句式。
4. Specify 阶段增加 EARS 结构与语义质量门禁。
5. 保留现有 FR/AC/NFR 稳定 ID、Traceability、Review、Evidence 和 Converge 机制。
6. 不考虑旧版 Spec 格式兼容。
7. 不修改 Workflow Runtime/DSL，优先复用现有原语。

## 二、新版 Spec 契约

统一使用以下组织结构：

* `spec.md`：需求、业务规则和 EARS 验收条件
* `plan.md`：技术架构与实现方案
* `tasks.md`：开发任务
* `traceability.json`：Requirement → Task 映射
* `review.json`：逐需求、逐 AC 的实现审查
* `evidence.json`：编译、测试及验证事实

### EARS 句式

| 类型 | 标准句式 |
| --- | --- |
| 事件驱动 | When [event], the [system] shall [action] |
| 状态驱动 | While [state], the [system] shall [action] |
| 异常处理 | If [condition], the [system] shall [action] |
| 可选功能 | Where [feature enabled], the [system] shall [action] |
| 全局约束 | The [system] shall [action] |
| 复合条件 | While [state], when [event], the [system] shall [action] |

允许中文事件、主体和行为内容，固定语法关键字保留英文。

### 编号与结构

* FR-NNN：功能需求，全局唯一。
* NFR-NNN：非功能需求，全局唯一。
* AC-NNN：验收条件，在整个 Spec 内全局唯一。
* 每个 FR/NFR 必须至少包含一条 AC。
* 每条 AC 只能归属一个 FR/NFR。
* 不允许没有归属的 AC、重复 ID 或无法验证的验收条件。
* 对缺少业务依据的数值或行为，不得擅自补充默认规则。

## 三、功能改造需求

### ER-FR-001：Specify EARS 生成

Specify Agent 必须读取 EARS 规则和新版 Spec 模板，根据用户提供的 PRD 或自然语言需求生成规范化的 `spec.md`。

**验收条件：** 每个 FR/NFR 都有 EARS AC，所有 ID 符合统一契约。

### ER-FR-002：EARS 确定性格式校验

新增 `validate-ears.mjs`，对 EARS 句式、AC ID、需求归属、必填结构执行确定性检查。

**验收条件：** 缺少触发语法、主体、shall、行为内容或 AC 归属时必须失败，并返回位置和原因。

### ER-FR-003：独立语义质量审查

增加独立 Reviewer，检查可测试性、歧义、单一行为原则和业务规则合理性。

**验收条件：** 格式正确但行为无法验证的 AC 不得通过；所有 AC 都必须有明确审查结论。

### ER-FR-004：修复与澄清机制

对格式和局部表述问题支持最多两轮自动修复。

**验收条件：** 真正的业务歧义必须请求人工确认；修复失败不得进入 Plan；无人工确认不得凭空添加业务默认值。

### ER-FR-005：统一 Spec 解析器

建立统一的 FR/NFR/AC 解析模块，避免 Coverage、Review、Converge、Audit 独立使用不一致的正则表达式。

**验收条件：** 各阶段解析出的 ID、AC 集合和归属完全一致。

### ER-FR-006：Coverage Gate 增强

所有 NFR 必须包含 AC；所有 AC 必须映射到正确的 Requirement 和真实 Task。

**验收条件：** NFR 的空 `acceptanceIds` 不再合法；跨需求错误映射或任何遗漏都必须使 Coverage 失败。

### ER-FR-007：Review 与 Converge 增强

所有 FR/NFR 均必须逐 AC 提供验证证据，不再允许旧式 NFR 无 AC 的验证路径。

**验收条件：** 只有每条 AC 都有有效且通过的验证证据，Requirement 才能通过；缺失、失败或无效的证据不得使 Workflow 收敛。

### ER-FR-008：独立 Audit 适配

`sdd-audit.js` 及配套解析、收敛脚本统一适配新版 Spec。

**验收条件：** 独立审计能够检查所有 FR/NFR/AC，保留只读 Reviewer 和源码完整性检查。

### ER-FR-009：审批及基线一致性

EARS Gate 必须在 Plan 之前完成，只有通过验证的 Spec 才能进入后续步骤。

**验收条件：** Spec 修改后必须重新验证；审批冻结后的 Spec 不得被自动修改以绕过质量规则。

### ER-FR-010：诊断与报告

校验失败必须输出对应的 AC、错误类型、位置和原因。

**验收条件：** Workflow 可以区分格式错误、语义错误、待澄清及验证通过等状态。

## 四、目标 Workflow

原始 PRD / 用户需求

→ Specify Agent

→ EARS Syntax Gate

→ EARS Semantic Gate

→ 自动修复或人工澄清（如需要）

→ Plan

→ Tasks + Traceability

→ Analyze / Coverage

→ Checkpoint / Baseline

→ Implement

→ Test

→ Review

→ Converge

**强制约束：** EARS Gate 未通过时，不允许 Plan Agent 启动。

## 五、修改范围

| 文件 | 主要改造 |
| --- | --- |
| `sdd/templates/spec.md` | 新版 EARS Spec 模板 |
| `sdd/rules/ears-format.md` | 新增规则 |
| `sdd/tools/spec-parser.mjs` | 新增统一解析器 |
| `sdd/tools/validate-ears.mjs` | 新增确定性校验 |
| `sdd-feature.js` | Specify、Gate、重试和澄清 |
| `coverage.mjs` | FR/NFR 全量 AC 覆盖 |
| `audit-spec-parse.mjs` | 使用统一解析 |
| `validate-review.mjs` | 逐 AC 证据结构校验 |
| `is-converged.mjs` | 逐 AC 收敛判定 |
| `sdd-audit.js` | 审计入口适配 |
| `audit-converge.mjs` | 审计证据及归属校验 |
| 相关测试 | 新增规则与端到端回归 |

## 六、实施优先级

**P0：EARS 基础契约**

完成 Spec 模板、EARS 规则、统一解析器、确定性格式检查及 Coverage 适配，确保格式错误不能进入 Plan。

**P1：质量门禁与端到端集成**

完成独立 Reviewer、自动修复、人工澄清，以及 Feature/Audit 两条链路的逐 AC 验收和回归测试。

**P2：未来独立增强**

增加 PRD 原始需求 Source ID、来源到 Spec 的双向追踪与遗漏审计。P2 不属于本次 EARS 改造的完成条件。

## 七、核心验收标准

* 合法 EARS 句式能够通过格式检查。
* 非 EARS 句式、无 AC 的 FR/NFR、重复 ID、错误 AC 归属必须被拒绝。
* 语法合格但语义模糊的 AC 必须被语义 Gate 识别。
* 两轮修复无法解决的问题不得被静默忽略。
* 所有 FR/NFR/AC 必须存在正确的 Task 映射。
* 所有 AC 必须存在有效的验证证据。
* Feature 与 Audit 对同一 Spec 的解析和验收口径必须一致。
* Reviewer 报告 pass 但证据失败或缺失时，Converge 必须失败。
* 审批和 specHash 保护继续有效。
* 全部端到端验收通过后方可宣布改造完成。

## 八、完成定义

项目必须满足 EARS 强制规范、新版 Spec 统一契约、双层质量门禁、逐 AC 任务与证据追踪，以及 Feature/Audit 两条工作流无回归，方视为改造完成。

不要求迁移任何旧版 Spec，不新增独立 Requirements 文档，不修改底层 Workflow Runtime。

完整 Markdown 文件还包括更细的 20 项测试场景、每个改造项的验收细则、失败处理规则以及源码参考链接，可以直接交给 OpenCode 作为需求输入。

目前仅完成需求文档，尚未修改 GitHub 仓库或执行开发。