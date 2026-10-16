# 超长 PRD 大文档处理规则（large-prd-intake）

> 适用于 `sdd_feature` 的大文档模式（`args.prdPath` 提供超长 Markdown PRD 时启用）。
> 工具链：`prd-chunker.mjs` → 分块提取（Chunk-Intake-*）→ `merge-claims.mjs` → Chunk Gate A。
> 总规则见 `dev-docs/planning/LPRD-P0~P3-执行文档.md`；Claim 元数据契约见 `sdd/rules/source-extraction.md`（EARS-P3）。

## 一、切块约定（LPRD-P0）

1. **原文保护**：`prd-chunker.mjs` 将 PRD 文件字节级复制到 `specs/<feature>/source-prd.md`，任何阶段不经 LLM 改写原文；prdHash（SHA256）锚定。
2. **原子块**：章节正文按空行切分；代码围栏（``` 配对）内的空行不切；表格、嵌套列表天然整块（连续非空行）。围栏内的 `#` 不是标题。
3. **Token 预算**：保守估算 `est = CJK 字符数 * 1 + 其他字符数 * 0.25`，向上取整；默认预算 3000 est-tokens/Chunk，可用 `--budget` 调整。宁可块小，不可超上下文。
4. **装包**：章节内贪心打包连续原子块；**章节不跨块合并**（语义边界优先）；块间空行归前一 Chunk，保证主覆盖区间 `1..总行数` 无缺口无重叠。
5. **overlap 前缀**：同章节内新 Chunk 前置上一 Chunk 的末块作上下文（当前实现 0 关闭或 1 块，`--overlap` 控制）；overlap 块的主归属仍是上一 Chunk（责任块唯一）。
6. **oversize**：单个原子块超预算（巨型表格/围栏）独立成 Chunk 并标记 `oversize: true`，**绝不从中间切开**（禁止静默截断）；容量门禁（LPRD-P3）会拦截。
7. **产物契约**：`intake/manifest.json`（chunkId/sectionPath/overlapStart/lineStart/lineEnd/estTokens/hash/oversize）+ `intake/chunks/CHUNK-NNN.md`（原文 `overlapStart||lineStart .. lineEnd` 的字节级切片）。校验器 `validate-chunks.mjs`：主覆盖完整、切片逐字节一致、哈希匹配、目录无多余文件。
8. **稳定性**：chunker 为纯函数（同输入同输出）；manifest 已存在时默认拒绝重切（`--force` 才覆盖）。

## 二、局部 Claim 契约（LPRD-P1，供分块提取 Agent）

每块产物 `intake/claims/CHUNK-NNN.json`：

```json
{
  "chunkId": "CHUNK-001",
  "claims": [
    {
      "localId": "L-001",
      "text": "需求点原文或保守转述",
      "claimType": "functional",
      "loadBearing": true,
      "lineStart": 12,
      "lineEnd": 12,
      "quote": "Chunk 文件中逐字存在的引文"
    }
  ]
}
```

纪律：

1. `localId` 为 `L-NNN`（块内编号，从 001 起）；并行提取互不协调，全局唯一性由 `merge-claims.mjs` 保证。
2. `lineStart/lineEnd` 是 **Chunk 文件内**的相对行号（从 1 起，注意 Chunk 文件可能带 overlap 前缀行）；quote 必须逐字来自本 Chunk 文件且落在该行号区间内（`validate-claims.mjs` 确定性校验）。
3. claimType 六枚举、loadBearing、非功能/否定性/例外/关键数值不漏——与 `sdd/rules/source-extraction.md` 的 Claim 纪律一致，只是编号与行号是块内的。
4. 纯背景章节允许零 Claim（空 claims 数组合法）。
5. 合并纪律：quote 归一化相同 → 确定性归并；语义重复由 Merge Agent 判定并给 reason；**跨章节冲突只登记（status=unresolved）不允许选边**，交人工裁决。

## 三、Chunk Gate A 纪律（LPRD-P2，供逐块审查 Reviewer）

1. 只读本块 Chunk 文件与本块已提取 Claim（含被归并的重复项），不预设完整。
2. missedClaims 的 quote 必须逐字来自本块**主区间**（overlap 前缀区不算——遗漏责任块唯一）；行号为 Chunk 文件内相对行号。
3. verdict：pass / fix（无 clarify，漏了就补）。
4. 聚合规则：全部块 pass 才 pass；missedClaim 被视为已解决当且仅当其 quote 与该块 claims 文件中某条 Claim 的 quote 归一化相同（补漏后重聚合，无需重审）。
