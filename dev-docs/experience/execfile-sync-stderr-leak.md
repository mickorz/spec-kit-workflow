# execFileSync 子进程 stderr 泄漏到测试输出

## 问题现象

Node 测试脚本用 `execFileSync('node', [...])` 调用被测工具（预期退出码 1 的负向用例）时，子进程写到 stderr 的 `[FAIL] ...` 诊断直接混入测试脚本自身的 stdout 输出，且顺序错乱（子进程 stderr 与父进程 console.log 交错），看起来像用例失败，实际用例全部通过。

## 排查过程

EARS-P3 的 validate-preservation-example.mjs 首次运行输出 12/12 通过，但夹带了未缩进的 `[FAIL] preservation-review 校验失败` 块，位置在 `[PASS]` 行之间。确认这些块不是测试脚本的 echo（脚本的 echo 有两空格缩进前缀），而是子进程 stderr。

## 根因

Node 官方行为：`execSync` / `execFileSync` 默认 `stdio` 配置下，**子进程的 stderr 输出到父进程的 stderr**（不会被捕获），只有 stdout 被捕获进返回值/异常对象。预期失败的负向用例触发被测工具 `console.error`，于是泄漏。

## 解决方案

`execFileSync(cmd, args, { stdio: 'pipe' })` 显式管道化全部三个流，stderr 捕获进 `e.stderr`，由测试脚本自行决定何时展示。

## 预防/注意事项

1. 写"调 CLI 工具 + 断言退出码"的测试脚本时，一律加 `stdio: 'pipe'`。
2. 若需在失败用例中展示子进程输出，用 `e.stdout + e.stderr` 拼接并加缩进前缀。
3. 同仓库 validate-ears-example.mjs / validate-source-map-example.mjs 用 `--json` 模式走 stdout，天然无此问题；纯文本模式的调用要注意。
