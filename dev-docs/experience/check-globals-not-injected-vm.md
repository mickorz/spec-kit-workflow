# check/fileExists/commandSuccess/sequence/fallback/race 未注入 VM 沙箱

> 日期：2026-10-13
> 引擎版本：@mickorz/opencode-dynamic-workflows 0.11.2
> 状态：已解决（根因：插件加载缓存，非代码 bug）

## 问题现象

首次运行 Workflow 时，以下 6 个 DSL 原语在 VM 沙箱中为 `undefined`：

- `check`、`fileExists`、`commandSuccess`、`sequence`、`fallback`、`race`

而其他 11 个原语正常可用：`agent`/`workflow`/`parallel`/`pipeline`/`phase`/`log`/`args`/`setConcurrency`/`verify`/`judgePanel`/`retry`/`checkpoint`/`console`

## 排查过程

1. 检查 `dist/runtime/workflow-runtime.js`：6 个函数均在 `executeWorkflow` 函数作用域内定义，且 `globals` 对象（line 967）明确包含。
2. 检查 `dist/runtime/vm.js`：`runScriptInVm` 使用 `vm.createContext({ ...globals })` 展开注入，无过滤。
3. VM 内 `Object.keys(globalThis)`：14 个可用全局中不包含上述 6 个。
4. 工具描述（DESCRIPTION 字符串）中列出的全局也不包含这 6 个（但这是文档滞后，不影响代码）。
5. 本地用 `vm.createContext({ ...globals })` 测试：展开注入正常，check 可访问。
6. 无 `let`/`var` 重名声明导致 TDZ 覆盖。

## 根因

**插件加载缓存**。

项目最初使用 junction 路径 `./thirdparties/opencode-dynamic-workflows` 作为插件来源。后来切换为全局 npm 包名 `@mickorz/opencode-dynamic-workflows`，但 OpenCode 仍使用缓存的旧插件实例（来自 junction 的 dist）。

junction 指向的引擎仓库 `E:\WorkProjects\opencode-dynamic-workflows` 的 dist 可能是更早的构建产物，不包含这 6 个原语在 globals 中。而 npm 包 v0.11.2 的 dist 包含全部原语。

切换插件来源后，OpenCode 未立即重新加载插件。后续会话重新加载 npm 包实例后，全部 17 个原语正常可用。

**这不是引擎代码 bug**：dist 源码正确包含全部原语。

## 解决方案

切换插件来源后重启 OpenCode 会话即可。具体步骤：

1. 修改 `opencode.json` 中的 `plugin` 配置
2. 关闭当前 OpenCode 会话
3. 重新启动 OpenCode
4. 运行原语探针验证全部可用

## 验证记录

- 探针 runId: `run-mv6aucrb` — 全部 17 个原语 typeof = "function"
- 功能测试 runId: `run-mv6avhj1` — 7 项功能测试全部通过
- 原生 P0.1 runId: `run-mv6aw9av` — 2 个 agent 成功，使用原生 check/fileExists/commandSuccess

## 预防/注意事项

- 切换 `opencode.json` 的 `plugin` 来源后，必须重启 OpenCode 会话
- 引擎升级后需重新验证全部 DSL 原语可用性
- 验证方法：运行不含本地替代函数的探针 Workflow，检查 `typeof` 结果
- 如同时存在 junction 和 npm 包，确认 OpenCode 实际加载的是哪个实例
