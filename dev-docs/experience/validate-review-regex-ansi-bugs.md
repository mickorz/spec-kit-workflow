# validate-review.mjs 正则 bug + Vitest ANSI 解析

## 问题现象

P0.6-B 集成测试中，validate-review.mjs 报告所有 FR 的 "ID 格式不合规"，但实际 ID 格式正确（FR-001 等）。

同时，run-tests.mjs 的 parseTestResults 无法从 Vitest 输出中提取测试结果，testResults 为 0。

## 排查过程

### Bug 1: validate-review.mjs 正则表达式

原代码：
```javascript
if (!/^([FR]|NFR)-\d+$/.test(req.id))
```

`[FR]` 是字符集，匹配单个字符 'F' 或 'R'。`"FR-001"` 中 `F` 匹配 `[FR]`，但 `R` 不匹配 `-`，整个正则失败。

修正：
```javascript
if (!/^(FR|NFR)-\d+$/.test(req.id))
```

`FR` 是字面量，`|` 是 alternation。`"FR-001"` 正确匹配 `^(FR|NFR)-\d+$`。

### Bug 2: parseTestResults 缺少 ANSI 清理

Vitest 输出包含 ANSI 转义码：
```
\x1b[32m✓\x1b[39m tests/lockout-status.test.ts \x1b[2m(10 tests)\x1b[22m
```

parseTestResults 的正则 `^\s*[✓✗×✔✖]\s+(.+)$` 无法匹配，因为 `\x1b[32m` 在 `\s` 和 `✓` 之间。

修正：在解析前清除 ANSI 转义码：
```javascript
const clean = output.replace(/\x1b\[[0-9;]*m/g, '')
```

清除后输出变为：
```
 ✓ tests/lockout-status.test.ts (10 tests) 1346ms
```

正则正确匹配，testResults 从 0 变为 34 项。

## 根因

1. 正则 bug：JavaScript 正则中 `[...]` 是字符集，不是分组。`[FR]` ≠ `FR`。
2. ANSI bug：终端输出包含颜色控制码，JSON 中保存为原始字符串，解析前需清理。

## 解决方案

- validate-review.mjs：`[FR]` → `FR`
- parseTestResults：新增 `output.replace(/\x1b\[[0-9;]*m/g, '')` 清理 ANSI

## 预防

- 正则中区分字符集 `[]` 和分组 `()` 的使用
- 处理终端输出时始终先清理 ANSI 转义码
- 回归测试应覆盖真实工具输出（不只是 mock 数据）
