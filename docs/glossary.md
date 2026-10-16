# SDD 术语表

本仓库 Spec-Driven Development（规格驱动开发）流程中使用的全部术语速查。

---

## 一、需求层术语

| 缩写 | 英文全称 | 中文含义 | 说明 |
|------|----------|----------|------|
| **Feature** | Feature | 功能特性 | 一个独立的开发单元，如 `login`、`task-manager`。作为 spec/plan/tasks 的命名空间，对应 `specs/<feature>/` 目录 |
| **Spec** | Specification | 需求规格 | 描述"做什么"的文档（`spec.md`），是整个流程的真相源（source of truth）。批准后冻结，不可随意修改 |
| **FR** | Functional Requirement | 功能需求 | 描述系统应该"做什么"的需求。每条 FR 对应一个可测试的功能行为，如"创建任务""用户登录"。编号格式 `FR-NNN`（三位数字，从 001 起不重复） |
| **NFR** | Non-Functional Requirement | 非功能需求 | 描述系统"做得怎么样"的质量约束，如性能、安全、可维护性。不直接对应用户可见功能，但约束功能的实现方式。编号格式 `NFR-NNN` |
| **AC** | Acceptance Criteria | 验收条件 | 每个 FR 下挂载的可验证条件，描述"做到什么程度才算完成"。一条 AC 是一条可测试的断言，如"标题为空时抛出错误"。编号格式 `AC-NNN`（全局唯一，从 001 起不重复）。每个 FR 至少一个 AC |
| **SRC** | Source Requirement | 原始需求点 | Intake 阶段从原始 PRD 中逐条提取的需求点，编号格式 `SRC-NNN`（三位数字，全局唯一）。是 PRD → Spec 方向防遗漏追踪的基准（EARS-P2） |
| **EARS** | Easy Approach to Requirements Syntax | 简易需求语法 | AC 的强制书写规范：触发关键字（When While If Where The shall）保留英文，五种基础句式 + 复合句式，每条 AC 单一行为。规则见 `sdd/rules/ears-format.md`，确定性校验器为 `validate-ears.mjs`（EARS-P0） |

### ID 编号规则

```
FR-001        功能需求第 1 条
  AC-001      验收条件第 1 条（可属于任意 FR）
  AC-002      验收条件第 2 条
FR-002        功能需求第 2 条
  AC-003      验收条件第 3 条
NFR-001       非功能需求第 1 条
  AC-004      NFR 也必须挂 AC（EARS 契约）
```

- FR/NFR 编号在各目内独立递增（FR-001..FR-008, NFR-001..NFR-005）
- AC 编号全局递增，不按 FR 分组重新计数
- EARS 契约（P0 起）：每个 FR 和 NFR 必须至少一个 AC，且全部符合 EARS 句式；NFR 的 acceptanceIds 不允许为空

---

## 二、计划与任务层术语

| 缩写 | 英文全称 | 中文含义 | 说明 |
|------|----------|----------|------|
| **Plan** | Technical Plan | 技术计划 | 描述"怎么做"的文档（`plan.md`）。为每条 FR/NFR 设计实现方案、涉及文件、数据流。在 Spec 之后、Tasks 之前生成 |
| **Tasks** | Task List | 任务清单 | 将 Plan 拆解为可执行的开发任务（`tasks.md`）。每个任务编号 `T-NNN`，关联 FR/AC，有 Status 字段 |
| **T-NNN** | Task ID | 任务编号 | 三位数字编号的任务标识，如 `T-001`。旧任务不删除只改 Status（保留历史），新任务追加 |
| **Status** | Task Status | 任务状态 | 任务的状态枚举：`pending`（待开始）→ `in-progress`（进行中）→ `done`（已完成）或 `blocked`（受阻） |

### Task Status 枚举

| 状态 | 含义 |
|------|------|
| `pending` | 未开始 |
| `in-progress` | 进行中 |
| `done` | 已完成 |
| `blocked` | 受阻（需排查阻塞原因） |

---

## 三、可追溯性与覆盖率

| 术语 | 英文 | 中文含义 | 说明 |
|------|------|----------|------|
| **Traceability** | Traceability Matrix | 需求追溯矩阵 | JSON 文件（`traceability.json`），建立 FR/NFR → Task → AC 的映射关系。确保每条需求都有对应任务和验收条件 |
| **Mapping** | Mapping | 映射条目 | Traceability 中的一条记录，包含 `requirementId`（FR/NFR 编号）、`taskId`（T 编号）、`acceptanceIds`（AC 编号列表）、`verificationMethod`（验证方式） |
| **verificationMethod** | Verification Method | 验证方式 | 枚举值：`test`（通过自动化测试验证）或 `manual`（通过人工检查验证）。NFR 常用 manual |
| **Coverage** | Coverage Gate | 覆盖率门禁 | 工具检查：Spec 中的每条 FR/NFR 都在 Traceability 中有映射、每个 Task 都在 tasks.md 中存在、没有遗漏或多余。未通过则阻断流程 |
| **Coverage Gate** | Coverage Gate | 覆盖率门禁检查 | 同上，`coverage.mjs` 执行，输出 `[OK]` 或 `[FAIL]` |
| **Intake** | Requirement Intake | 需求接入 | sdd-feature 的第一阶段（EARS-P2）：Agent 从原始 PRD 逐条提取 SRC 需点写入 source-map.json，原文逐字保存到 source-prd.md，prdHash 冻结防改写 |
| **source-map** | Source Map | 来源映射表 | `specs/<feature>/source-map.json`，记录 sources（SRC 需求点清单）与 mappings（SRC 到 FR/NFR/AC 的处置映射），由 `validate-source-map.mjs` 确定性校验 |
| **disposition** | Disposition | 处置结果 | source-map 中每个 SRC 的处理结论，枚举：`covered`（已转换，requirementIds 必填）/ `excluded`（明确不做，须 note 理由）/ `pending`（待澄清，须 note）。不允许静默丢失 |
| **Source Coverage Gate** | Source Coverage Gate | 来源覆盖门禁 | `validate-source-map.mjs` 执行的确定性检查：每个 SRC 必须有处置结果、covered 引用必须真实存在且归属正确、Spec 中每个 FR/NFR 必须追溯到至少一个 SRC（反向拦截无依据新增）。位于 Plan 之前 |
| **Claim** | Claim | 需求声明 | PRD 中一条可独立验证的原始陈述，即 SRC 需求点。BMAD Claim Preservation 思想：每条声明都必须被逐条验证在后续产物中语义保真（EARS-P3） |
| **claimType** | Claim Type | 声明类型 | 六枚举：functional（功能）/ constraint（约束）/ exception（例外）/ non-goal（非目标）/ assumption（假设）/ decision（决策）。否定性约束与非目标不是 FR 但也不能丢 |
| **loadBearing** | Load-bearing Claim | 承重声明 | 布尔标记：该 Claim 是否影响下游开发决策。为 true 且 claimType 为 functional/exception 的 covered 映射必须含 AC |
| **sourceRef** | Source Reference | 来源引用 | source-map 中每 SRC 的原文定位：file（固定 source-prd.md）+ lineStart/lineEnd（行号）+ quote（原文逐字引文）。确定性校验行号区间内包含引文 |
| **Gate A** | Intake Preservation Gate | 提取遗漏门禁 | 独立只读 Reviewer 重读 PRD 原文比对 SRC 台账，漏提记入 intake-review.json 的 missedClaims；两轮内补齐否则 Specify 不启动（EARS-P3） |
| **Gate B** | Claim Preservation Gate | 语义保真门禁 | 逐条核对 SRC 与 Spec 的语义保真，结论写入 preservation-review.json（锚定三哈希）；确定性校验 claims 全覆盖、证据完整、哈希一致；未通过不进 Plan（EARS-P3） |
| **Preservation 六状态** | Preservation Status | 保真状态枚举 | preserved（完整保留）/ partial（部分保留，丢条件丢数值）/ missing（无承接）/ contradicted（语义矛盾）/ uncertain（证据不足，人工澄清）/ excluded（明确排除，核对依据） |
| **重跑链** | Revalidation Chain | 失效校验重跑链 | 任何 Agent 修改 spec.md 后，EARS 格式、EARS 语义、Source Coverage、Claim Preservation 四类检查必须针对同一版本 Spec 重新成立；过期结论被哈希门禁拒绝（EARS-P3） |
| **Chunk** | PRD Chunk | 文档块 | 超长 PRD 按结构化切块产生的原文片段（CHUNK-NNN），文件为原文字节级切片；由 prd-chunker 生成，validate-chunks 校验完整性（LPRD-P0） |
| **manifest** | Chunk Manifest | 块清单 | intake/manifest.json：每块的章节路径、主覆盖行号区间、overlap 前缀、哈希与 oversize 标记；主覆盖区间必须无缺口无重叠覆盖全文（LPRD-P0） |
| **主覆盖区间** | Primary Coverage Range | 主覆盖区间 | Chunk 的 lineStart..lineEnd；全文每行恰属一个主区间。overlap 前缀行的主归属在上一块（责任块唯一）（LPRD-P0） |
| **oversize** | Oversize Chunk | 超限块 | 单个原子块（巨型表格/围栏）超过 Token 预算时独立成块并标记，绝不从中间切开；由容量门禁拦截（LPRD-P0/LPRD-P3） |
| **局部 Claim ID** | Local Claim ID | 块内需求点编号 | 分块提取时块内独立的 L-NNN 编号（相对行号 + 块内 quote），并行提取互不冲突；全局唯一 SRC-NNN 由 merge-claims 统一分配（LPRD-P1） |
| **merge-report** | Merge Report | 合并报告 | intake/merge-report.json：去重组（kept/merged/reason）、未解决冲突（跨章节矛盾只登记不选边）、srcAssignments（from + alsoFrom 溯源）；provenance 守恒：局部 ID 总数 = kept + alsoFrom + 冲突未分配（LPRD-P1） |

### Traceability 示例

```json
{
  "feature": "task-manager",
  "specHash": "sha256-...",
  "mappings": [
    {
      "requirementId": "FR-001",      // 对应 spec.md 中的 FR-001
      "taskId": "T-001",              // 对应 tasks.md 中的 T-001
      "acceptanceIds": ["AC-001", "AC-002"],  // 关联的验收条件
      "verificationMethod": "test"     // 用测试验证
    },
    {
      "requirementId": "NFR-004",     // 非功能需求
      "taskId": "T-010",
      "acceptanceIds": ["AC-012"],   // EARS 契约：NFR 也必须逐 AC 映射
      "verificationMethod": "manual"   // 用人工检查验证
    }
  ]
}
```

---

## 四、基线与冻结

| 术语 | 英文 | 中文含义 | 说明 |
|------|------|----------|------|
| **Baseline** | Approved Baseline | 审批基线 | 人工审批通过后冻结的 spec/tasks/traceability 哈希快照（`approved-baseline.json`）。之后编码阶段不可修改这些文件 |
| **Freeze** | Hash Freeze | 哈希冻结 | 计算文件内容的 SHA-256 哈希并持久化，用于后续检测文件是否被篡改 |
| **specHash** | Spec Hash | 规格哈希 | `spec.md` 内容的 SHA-256 哈希，前缀 `sha256-`。嵌入到 traceability.json、review.json、approved-baseline.json 中，确保引用的规格版本一致 |
| **Checkpoint** | Checkpoint | 人工审批点 | 工作流暂停，等待人工确认后才继续。如 Spec→Plan→Tasks 生成后有一个 checkpoint，批准后才进入编码阶段 |
| **check-baseline** | Baseline Check | 基线校验 | 每轮 Implement 前执行，检查 spec/traceability/tasks 的哈希是否与批准时一致。不一致则报错（规格被篡改） |

### approved-baseline.json 示例

```json
{
  "feature": "login",
  "approvedSpecHash": "sha256-7edff...",
  "approvedTraceabilityHash": "sha256-07f6...",
  "approvedTasksHash": "sha256-98d6...",
  "status": "approved",
  "frozenAt": "2026-10-13T09:28:29.974Z"
}
```

---

## 五、实现与测试层术语

| 术语 | 英文 | 中文含义 | 说明 |
|------|------|----------|------|
| **Implement** | Implementation | 实现 | 根据 spec/plan/tasks 编写源码和测试的阶段。第一轮从零实现，后续轮次根据 Findings 修复 |
| **Evidence** | Test Evidence | 测试证据 | 自动化测试运行结果（`evidence.json`），包含构建结果、测试通过/失败数、逐测试详情、源码文件哈希 |
| **Build** | Build | 构建 | TypeScript 编译检查（`tsc --noEmit`）。构建失败属于阻断级问题 |
| **Test Results** | Test Results | 测试结果列表 | evidence.json 中的 `testResults` 数组，每项含测试名称（`name`）和状态（`status: passed/failed`）。Reviewer 引用此处的 testId 作为验证证据 |
| **Round** | Round | 轮次 | Implement→Test→Review→Converge 循环的轮次编号。第 1 轮从零实现，未收敛则进入第 2 轮修复，最多 `maxRounds`（默认 3）轮 |
| **fileHashes** | File Hashes | 文件哈希表 | evidence.json 中记录的所有源码和测试文件的 SHA-256 哈希，用于检测测试后代码是否被修改 |

### evidence.json 结构概要

```json
{
  "feature": "task-manager",
  "round": 1,
  "status": "passed",            // 整体状态
  "build": {
    "passed": true,              // 构建是否通过
    "command": "npm run build",
    "exitCode": 0
  },
  "tests": {
    "passed": 11,                // 通过数
    "failed": 0,                 // 失败数
    "total": 11,                 // 总数
    "command": "npm test",
    "exitCode": 0
  },
  "testResults": [               // 逐测试详情
    { "name": "创建任务返回唯一id", "status": "passed" },
    { "name": "标题为空抛出错误", "status": "passed" }
  ],
  "fileHashes": [                // 文件哈希
    { "file": "src/index.ts", "hash": "sha256-..." }
  ]
}
```

---

## 六、审查层术语

| 术语 | 英文 | 中文含义 | 说明 |
|------|------|----------|------|
| **Review** | Review | 审查 | 独立 Reviewer Agent 逐条核对代码是否真正实现了 Spec 中的每条需求。不信任 tasks.md 的 done 标记，只信任代码和测试证据 |
| **Reviewer** | Reviewer Agent | 审查代理 | 执行 Review 的独立 Agent。在 sdd-feature 流程中使用 `general` 类型（可写），在 sdd-audit 流程中使用 `explore` 类型（只读，不可修改代码） |
| **review.json** | Review Result | 审查结果 | Reviewer 输出的 JSON 文件，包含每条 FR/NFR 的审查状态和验证证据 |
| **Verification** | Verification | 验证条目 | 对每个 AC 的验证方式记录，挂在 review.json 的 requirement 下。三种类型见下表 |

### Verification 类型

| type | 中文 | 必填字段 | 说明 |
|------|------|----------|------|
| `automated_test` | 自动化测试 | `testId`、`result` | testId 必须在 evidence.json 的 testResults 中真实存在且状态为 passed |
| `static_check` | 静态检查 | `reason`、`fileRef`、`result` | 人工阅读代码确认，fileRef 指向具体文件:行号，如 `src/auth.ts:50` |
| `manual` | 人工验证 | `reason`、`approver`、`result` | 需审批人标识（如 `code-reviewer-zhang`），无审批人则标记 unverified |

### 审查状态枚举（Review Status）

| 状态 | 中文 | 含义 | finding 要求 |
|------|------|------|-------------|
| `pass` | 通过 | 需求已正确实现，每个 AC 有验证证据 | finding 为 null |
| `partial` | 部分实现 | 有相关逻辑但不完整，缺少某些 AC 的实现 | finding 必须非空，说明缺了什么 |
| `missing` | 完全缺失 | 代码中找不到任何相关逻辑 | finding 必须非空 |
| `contradicts` | 与 Spec 矛盾 | 代码中存在实现，但行为与 Spec 描述冲突（如阈值不匹配、消息文案不一致） | finding 必须非空，说明矛盾点 |
| `unverified` | 无法验证 | 代码看起来正确，但没有充分的测试证据 | finding 必须非空 |

### 状态区分要点

```
值不匹配（参数/阈值/文案与 Spec 不一致）= contradicts
功能部分缺失（有框架但缺关键逻辑）       = partial
功能完全不存在                           = missing
代码正确但无测试证据                     = unverified
全部 AC 有证据                           = pass
```

### review.json 结构示例

```json
{
  "feature": "task-manager",
  "round": 1,
  "specHash": "sha256-...",
  "reviewerLabel": "Reviewer-R1",
  "requirements": [
    {
      "id": "FR-001",
      "status": "pass",
      "evidenceRefs": ["AC-001", "AC-002"],
      "verifications": [
        {
          "ac": "AC-001",
          "type": "automated_test",
          "testId": "创建任务返回唯一id",
          "result": "passed"
        },
        {
          "ac": "AC-002",
          "type": "static_check",
          "testId": null,
          "result": "passed",
          "reason": "description 默认空字符串在 TaskManager.create() 中确认",
          "fileRef": "src/task-manager.ts:15"
        }
      ],
      "finding": null
    },
    {
      "id": "FR-005",
      "status": "missing",
      "evidenceRefs": ["AC-012"],
      "verifications": [],
      "finding": "代码中未找到删除任务的实现"
    }
  ]
}
```

---

## 七、收敛与修复

| 术语 | 英文 | 中文含义 | 说明 |
|------|------|----------|------|
| **Converge** | Convergence | 收敛 | 一轮 Implement→Test→Review 后的判定环节：7 项条件全部通过则收敛（流程结束），否则生成 Findings 进入下一轮 |
| **Converge Report** | Convergence Report | 收敛报告 | `converge-report.json`，记录 7 项条件（C1-C7）各自的通过/失败状态和详情 |
| **Findings** | Findings | 缺口清单 | 未收敛时从 evidence.json + review.json 提取的问题清单（`findings.json`），作为下一轮修复的输入 |
| **F-NNN** | Finding ID | 缺口编号 | Findings 中的条目编号，如 `F-001`。每条对应一个修复任务（追加到 tasks.md） |

### Finding 类型

| type | 中文 | 来源 | 说明 |
|------|------|------|------|
| `requirement_gap` | 需求缺口 | review.json | Reviewer 发现的未实现/不完整/矛盾的需求。必须实现对应功能 |
| `test_failure` | 测试失败 | evidence.json | 测试未通过。需修复代码使测试通过 |
| `test_infrastructure` | 测试设施问题 | evidence.json | 测试工具/命令/配置问题（如构建失败、无测试执行）。需调整测试命令或配置 |

### findings.json 结构示例

```json
{
  "feature": "task-manager",
  "round": 1,
  "items": [
    {
      "findingId": "F-001",
      "taskId": "T-013",
      "type": "requirement_gap",
      "source": "review.json",
      "requirementId": "FR-005",
      "status": "missing",
      "reason": "代码中未找到删除任务的实现",
      "evidenceRefs": ["AC-012"],
      "action": "fix"
    },
    {
      "findingId": "F-002",
      "taskId": "T-014",
      "type": "test_failure",
      "source": "evidence.json",
      "test": "按优先级排序",
      "reason": "期望 high 在前，实际 low 在前",
      "action": "fix"
    }
  ],
  "derivedFrom": "evidence.json + review.json"
}
```

---

## 八、收敛条件（C1-C7）

收敛判定检查 7 项条件，全部通过才算收敛。

| 条件 | 名称 | 检查内容 | 数据来源 |
|------|------|----------|----------|
| **C1** | Coverage Gate | Spec 中每条 FR/NFR/AC 都在 Traceability 中有映射，Task ID 在 tasks.md 中存在 | spec.md + traceability.json + tasks.md |
| **C2** | Review 完整性 | review.json 包含 spec.md 中的所有 FR 和 NFR，无遗漏无多余 | spec.md + review.json |
| **C3** | 全部通过 | review.json 中每条 FR/NFR 的 status 都是 `pass` | review.json |
| **C4** | AC 证据完整性 | 每个 AC 有 verification 条目；automated_test 的 testId 在 evidence 中存在且 passed；static_check 有 reason 和 fileRef；manual 有 reason 和 approver | review.json + evidence.json |
| **C5** | 构建与测试通过 | evidence.json status=passed，构建通过，测试数 > 0，无失败 | evidence.json |
| **C6** | 文件哈希一致 | evidence.json 中记录的文件哈希与当前磁盘文件一致（测试后代码未被篡改） | evidence.json + 磁盘文件 |
| **C7** | 无阻断级问题 | 不存在 missing/contradicts/unverified 状态的需求；构建不失败；测试数不为零 | review.json + evidence.json |

### 收敛状态

| status | 含义 | 条件 |
|--------|------|------|
| `converged` | 已收敛 | C1-C7 全部通过 |
| `pending_review` | 待审查 | C1/C5/C6（工程条件）通过，但 C2/C3/C4/C7 未通过（Review 层面有缺口） |
| `not_converged` | 未收敛 | 工程条件（C1/C5/C6）有未通过项 |

---

## 九、审计层术语

| 术语 | 英文 | 中文含义 | 说明 |
|------|------|----------|------|
| **Audit** | Audit | 审计 | 对已有代码进行 Spec↔Code 一致性审查的独立流程（`sdd-audit` workflow）。不需要从零生成 spec，而是拿已有 spec 审查已有代码 |
| **Snapshot** | Code Snapshot | 代码快照 | 审计前后对项目源码的哈希快照。如果审计过程中代码被修改（前后快照不一致），审计结果标记为 `invalid` |
| **Code Integrity** | Code Integrity | 代码完整性 | 审计前后快照对比，确保 Reviewer 审查过程中代码未被修改。explore 只读 Reviewer 无 write 权限 |
| **invalid** | Invalid | 审计无效 | 代码在审计过程中被修改，Review 结论不可信。审计结果不采纳 |

### sdd-feature vs sdd-audit 对比

| | sdd-feature | sdd-audit |
|------|------------|-----------|
| 目的 | 从零走完整 spec 驱动开发流程 | 审查已有代码与 spec 的一致性 |
| 输入 | feature + goal（需求描述） | specPath + projectPath（已有 spec 和代码） |
| Spec 生成 | 自动生成 | 不生成（使用已有 spec） |
| 实现 | 自动实现 | 不实现（审查已有代码） |
| Reviewer 类型 | general（可写） | explore（只读） |
| 循环 | 多轮 Implement→Test→Review→Converge | 单次审查 |
| 代码修改 | 允许（实现阶段） | 禁止（审查阶段） |

---

## 十、工作流全局函数

工作流脚本（`.opencode-workflows/workflows/*.js`）中可用的全局函数：

| 函数 | 含义 | 说明 |
|------|------|------|
| `agent(prompt, opts)` | 调用子代理执行任务 | opts 可指定 `agentType`（general/explore）、`label`、`timeoutMs` |
| `phase(title)` | 标记当前阶段 | 在日志中分组显示，如 `phase('Implement')` |
| `check(fn, msg)` | 断言检查 | fn 返回 false 时工作流报错终止，msg 为错误描述 |
| `checkpoint(msg, opts)` | 人工审批暂停 | 工作流暂停等待人工确认。opts.headless 可设为 'approve'（无头模式自动批准） |
| `log(msg)` | 记录日志 | 输出到工作流日志 |
| `commandSuccess(cmd, timeout)` | 执行命令 | 执行 shell 命令，返回成功/失败布尔值 |
| `fileExists(path)` | 文件存在检查 | 返回布尔值 |

---

## 术语关系图

```
需求层          计划层              实现层          审查层          收敛层
------          ------              ------          ------          ------
Spec ──────> Plan ──────> Tasks ──────> Implement ──> Review ──> Converge
  |             |             |              |            |           |
  FR-NNN        模块设计      T-NNN          Evidence    review.json  C1-C7
  NFR-NNN       数据流        Status         Build       Verification Findings
  AC-NNN        风险约束      pending/done   TestResults pass/partial  F-NNN
                                            fileHashes  missing       └─> 下一轮
                                                         contradicts
                                                         unverified

  冻结层:  Baseline ← specHash ← Freeze ← Checkpoint(人工审批)
  
  审计层:  Audit ← Snapshot(before) → Reviewer(explore只读) → Snapshot(after) → Code Integrity
```
