# Feature: Task Manager

## 概述

一个轻量级任务管理器，支持任务的创建、查询、更新、删除、状态变更及过滤排序。数据存储为内存模式，不涉及持久化。

## 功能需求

### FR-001: 创建任务

用户可以通过提供标题创建一个新任务，可选提供描述和优先级。

- 入参：title（必填）、description（可选，默认空字符串）、priority（可选，默认 medium）
- 返回：创建的 Task 对象（含自动生成的唯一 id、createdAt 时间戳）

**验收条件**：
- AC-001: 提供合法 title 时，返回包含该 title 的 Task 对象，且 id 唯一
- AC-002: 不提供 description 时，description 为空字符串
- AC-003: 不提供 priority 时，priority 为 "medium"
- AC-004: createdAt 为当前时间（ISO 8601 格式）

### FR-002: 查询所有任务

用户可以获取当前所有任务的列表。

- 无入参
- 返回：Task 数组，按创建时间升序排列

**验收条件**：
- AC-005: 无任务时返回空数组
- AC-006: 有多个任务时返回全部，且按 createdAt 升序排列

### FR-003: 查询单个任务

用户可以通过 id 获取单个任务详情。

- 入参：id（string）
- 返回：Task 对象或 null（不存在时）

**验收条件**：
- AC-007: 提供存在的 id 时返回对应 Task 对象
- AC-008: 提供不存在的 id 时返回 null

### FR-004: 更新任务

用户可以通过 id 更新任务的标题、描述和优先级。

- 入参：id、title（可选）、description（可选）、priority（可选）
- 返回：更新后的 Task 对象，或 null（任务不存在时）
- 仅更新提供的字段，未提供的字段保持不变

**验收条件**：
- AC-009: 提供存在的 id 和新 title 时，返回的 Task title 已更新，其他字段不变
- AC-010: 提供不存在的 id 时返回 null
- AC-011: 仅提供部分字段时，未提供的字段保持原值

### FR-005: 删除任务

用户可以通过 id 删除任务。

- 入参：id（string）
- 返回：boolean（true 表示删除成功，false 表示任务不存在）
- 删除后，后续查询不应返回该任务

**验收条件**：
- AC-012: 提供存在的 id 时返回 true，且之后查询该 id 返回 null
- AC-013: 提供不存在的 id 时返回 false

### FR-006: 标记任务状态

用户可以通过 id 将任务标记为完成或未完成。

- 入参：id、status（"completed" 或 "pending"）
- 返回：更新后的 Task 对象，或 null（任务不存在时）
- 默认新建任务状态为 "pending"

**验收条件**：
- AC-014: 新建任务的 status 为 "pending"
- AC-015: 将 pending 任务标记为 completed 后，返回的 Task status 为 "completed"
- AC-016: 提供不存在的 id 时返回 null
- AC-017: 提供非法 status 值时抛出错误

### FR-007: 按状态过滤任务

用户可以按状态过滤任务列表。

- 入参：status（"completed" 或 "pending" 或 "all"）
- 返回：过滤后的 Task 数组

**验收条件**：
- AC-018: status 为 "completed" 时仅返回已完成的任务
- AC-019: status 为 "pending" 时仅返回未完成的任务
- AC-020: status 为 "all" 时返回全部任务

### FR-008: 按优先级排序

用户可以获取按优先级排序的任务列表。

- 优先级排序规则：high > medium > low（同优先级按 createdAt 升序）
- 入参：无
- 返回：排序后的 Task 数组

**验收条件**：
- AC-021: 返回的数组按优先级降序排列（high 在前）
- AC-022: 同优先级的任务按 createdAt 升序排列

## 非功能需求

### NFR-001: 标题长度校验

任务标题长度必须在 1 到 200 个字符之间（含边界）。空标题或超长标题应抛出校验错误。

### NFR-002: 优先级枚举校验

优先级仅允许 "low"、"medium"、"high" 三个值。非法值应抛出校验错误。

### NFR-003: ID 唯一性

每个任务的 id 必须全局唯一，使用 UUID v4 格式生成。不可手动指定 id。

### NFR-004: 内存存储

所有数据存储在内存中，不涉及文件系统或数据库。TaskManager 实例化时数据为空。

### NFR-005: 不可变返回

查询返回的 Task 对象应为深拷贝，修改返回值不应影响内部存储的数据。

<!-- ID 规则：FR-NNN 三位数字从 001 起不重复；AC-NNN 三位数字从 001 起不重复；每个 FR 至少一个 AC -->
