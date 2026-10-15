# Task Manager 测试工程

用于测试 spec + audit 全流程的开发期沙盒。

## 目录结构

```
dev-examples/task-manager/
├── spec.md          预写规格（8 个 FR + 5 个 NFR）
├── app/             被审计的项目
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   └── index.ts
│   └── tests/
└── README.md        本文件
```

## 运行方式

### 1. 安装依赖

```powershell
cd dev-examples\task-manager\app
npm install
```

### 2. 实现

在 `app/src/` 下编写 TaskManager 实现，在 `app/tests/` 下编写测试。

### 3. 运行 audit 流程

使用 sdd-audit workflow 审计实现与 spec 的一致性：

```powershell
# 通过 workflow tool 调用
# args: {
#   "specPath": "dev-examples/task-manager/spec.md",
#   "projectPath": "dev-examples/task-manager/app",
#   "outputDir": "audit-results/task-manager",
#   "feature": "task-manager"
# }
```

### 4. 运行 sdd-feature 流程（完整 spec 驱动开发）

如果想测试从 spec 生成到实现到 review 的完整流程，使用 sdd-feature workflow：

```powershell
# args: {
#   "feature": "task-manager",
#   "goal": "一个轻量级任务管理器，支持任务的创建、查询、更新、删除、状态变更及过滤排序。数据存储为内存模式。"
# }
```

注意：sdd-feature 会在 `specs/task-manager/` 和 `fixtures/task-manager-app/` 下生成文件，不在 dev-examples 内。

## 需求概要

- FR-001: 创建任务（title 必填，description/priority 可选）
- FR-002: 查询所有任务（按 createdAt 升序）
- FR-003: 查询单个任务（by id）
- FR-004: 更新任务（部分字段更新）
- FR-005: 删除任务
- FR-006: 标记任务状态（pending/completed）
- FR-007: 按状态过滤
- FR-008: 按优先级排序（high > medium > low）
- NFR-001: 标题长度 1-200
- NFR-002: 优先级枚举 low/medium/high
- NFR-003: ID 唯一（UUID v4）
- NFR-004: 内存存储
- NFR-005: 不可变返回（深拷贝）
