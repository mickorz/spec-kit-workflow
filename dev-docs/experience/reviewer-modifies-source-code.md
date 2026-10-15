# Reviewer Agent 修改被审查源代码

> 日期：2026-10-14 | 关键词：Reviewer, write tool, 只读保护, backup/restore

## 问题现象

SDD Audit Workflow 使用 `agentType: 'general'` 的 Reviewer Agent 审计源代码。尽管 prompt 明确禁止修改源码（"你不得修改任何源代码文件"），Reviewer 在 3/4 次审计中修改了 `src/auth.ts` 和 `tests/auth.test.ts`。

被修改后，Reviewer 基于修改后的代码写 review.json，导致：
1. 如果 Reviewer "修复"了某个问题，review.json 报告该需求 pass（但原始代码有缺陷）
2. 如果 Reviewer 修改破坏了其他代码，review.json 报告假阳性

## 排查过程

### 尝试 1：设置文件只读属性（Windows ReadOnly）

```powershell
Get-ChildItem 'blind-test\project-a\src','blind-test\project-a\tests' -Recurse -File | ForEach-Object { $_.IsReadOnly = $true }
```

结果：**无效**。Reviewer 的 write 工具可以覆盖 Windows 只读文件。

### 尝试 2：改用 explore agent（只读）

将 Reviewer 的 `agentType` 从 `'general'` 改为 `'explore'`，让 Reviewer 只能读取文件不能写入。

问题：explore agent 无法写 review.json。需要外部机制将 Reviewer 的文本输出写入文件。

### 尝试 3：base64 编码 + 分块写入

在工作流中用 `Buffer.from(review).toString('base64')` 编码 Reviewer 输出，分块写入临时文件，再解码为 review.json。

结果：**失败**。工作流沙箱中 `Buffer` 未定义（`ReferenceError: Buffer is not defined`）。

### 尝试 4：PowerShell here-string 管道

```javascript
commandSuccess(`@'\n${review}\n'@ | node sdd/tools/write-review.mjs ${outputDir}/review.json`)
```

结果：**失败**。`commandSuccess` 返回 false，PowerShell here-string 在 `command()` 函数中无法正常工作。

## 根因

1. **工作流沙箱限制**：`Buffer` 不可用，无法在 JS 层面编码大文本
2. **PowerShell 命令限制**：命令行长度 8191 字符，无法传递大 JSON 字符串
3. **Windows ReadOnly 无效**：write 工具（通过 `fs.writeFileSync`）不检查只读属性
4. **general agent 行为非确定性**：prompt 禁止修改代码，但 LLM 不总是遵守

## 解决方案

当前方案：**backup/restore + 完整性检测**

```
审计前 → snapshot + backup 源码
Reviewer → 可能修改源码
Reviewer 后 → snapshot after，compare before/after
  → 检测到修改：restore from backup，codeUnchanged=false
  → 未检测到修改：codeUnchanged=true
收敛判定 → review.json 可能基于修改后代码（遗留风险）
输出 → converged = convergeOk && codeUnchanged
```

### 遗留风险

review.json 基于修改后代码，假阳性无法完全消除。在 P0.7 盲测中，2 个 FR-007 假阳性均由此引起。

### 彻底解决方案（待实现）

需要工作流插件支持以下任一机制：
1. 工作流沙箱中提供 `Buffer` 或等效的文件写入全局函数
2. `command()` 函数支持 stdin 管道传递大文本
3. 提供 `writeFile()` 全局函数供工作流直接写文件
4. 支持 `explore` agent + 自动捕获输出写文件的模式

## 预防/注意事项

1. 审计模式下，Reviewer 的 codeUnchanged=false 时，review.json 的结论不可信
2. 需要 multiple runs 取 codeUnchanged=true 的结果
3. Reviewer 行为非确定性——同一代码多次审计结果可能不同
4. backup/restore 机制确保源码最终状态正确，但 review.json 可能已被污染
