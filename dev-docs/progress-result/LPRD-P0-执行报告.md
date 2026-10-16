# LPRD-P0 执行报告：PRD Chunker 与 Manifest

> 阶段：LPRD-P0
> 完成日期：2026-10-16
> 执行文档：`dev-docs/planning/LPRD-P0-执行文档.md`
> 状态：完成（纯确定性交付，全部本机验证通过）

## 一、交付清单

| 任务 | 交付物 | 结果 |
|------|--------|------|
| T01 | `sdd/tools/prd-chunker.mjs` | 原文字节级复制 + prdHash；Markdown 标题树（围栏内不算标题）；空行切原子块（围栏内空行不切）；est-tokens 保守估算；章节内贪心装包 + overlap 前缀块；原子块超预算独立 oversize 不截断；块间空行归前一 Chunk；段尾剩余行归段内最后 Chunk；纯空行前言段生成空 Chunk |
| T02 | `sdd/tools/validate-chunks.mjs` | prdHash / 主覆盖 1..N 无缺口无重叠 / Chunk 文件逐字节切片 + 哈希 / overlap 落界 / oversize 语义 / 目录无多余文件；附加 `--exists CHUNK-NNN` 探针模式（供工作流循环，适配 commandSuccess 布尔原语） |
| T03 | `sdd/tools/prd-chunker-example.mjs` | **11/11 通过**（C01-C10 + 探针 C10b） |
| T04 | `sdd/rules/large-prd-intake.md` | 切块约定八条 + 局部 Claim 契约（P1 用）+ Chunk Gate A 纪律（P2 用） |

## 二、测试结果

| 用例 | 结果 |
|------|------|
| C01 多级标题（sectionPath 含背包系统/堆叠规则 等嵌套路径） | 通过 |
| C02 表格整块不切 | 通过 |
| C03 代码围栏（内含空行）整块不切 | 通过 |
| C04 超长章节按预算拆分（40 段 → 40+ 块，主覆盖连续） | 通过 |
| C05 巨型表格（60 行）→ 1 个 oversize 独立块不截断 | 通过 |
| C06 组合 fixture | 通过 |
| C07 删原文一行 → 拒绝 | 通过 |
| C08 篡改 Chunk 文件 → 拒绝 | 通过 |
| C09 overlap 后缀一致性 | 通过 |
| C10 稳定性（两次运行 manifest 逐字节一致） | 通过 |
| C10b --exists 探针（存在/不存在） | 通过 |
| 边界补测：纯空行前言段 | 通过（空 Chunk 承接，主覆盖完整） |

## 三、实现要点与排坑

1. **块间空行缺口**（首版缺陷）：块按空行切分后，块间空行不属于任何块，主覆盖出现缺口。修复：Chunk 边界改为"切到下一块起始行前"，空行归前一 Chunk；段尾剩余行归段内最后 Chunk；无块段生成空 Chunk。C06 首跑 13 处覆盖错误 → 修复后全绿。
2. **est-tokens 口径**：CJK 1、其他 0.25 的保守启发式，与真实 tokenizer 无关，只做预算控制；文档已注明"宁可块小"。
3. **探针模式**：workflow VM 无 fs，无法枚举 chunk 列表；validate-chunks 增加 `--exists`（manifest 查询退出码），工作流按序探测即可遍历（P3 接线用）。
4. **--force 语义**：默认拒绝重切（提取可能已开始），--force 才覆盖；chunker 纯函数保证同输入重切结果一致。

## 四、遗留问题

1. 无换行巨型段落（整段一行）无法按空行切块 → 整体成块标 oversize，由容量门禁报告（执行文档已声明，罕见场景不复杂化）。
2. overlap 当前实现 0 或 1 块（--overlap >1 按 1 处理），规则文件已注明。

## 五、commit 记录

见仓库提交历史（本报告与代码同批提交）。
