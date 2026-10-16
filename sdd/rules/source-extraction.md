# 原始需求提取与来源映射规则（source-extraction）

> 本规则约束两个 Agent 的行为：
> 1. Intake Agent（提取原始需求，分配 SRC-ID）
> 2. Source Mapping Agent（填写 SRC 到 Spec 的处置结果）
> 确定性校验由 `sdd/tools/validate-source-map.mjs` 执行（Source Coverage Gate）。

## 一、Intake：提取粒度

1. 一个可独立验证的需求点 = 一个 SRC。一句话含多个独立行为时必须拆分。
2. 原始需求的每一条明确要求都必须有对应 SRC，不得合并、不得省略。
3. 粒度锚点：30 条 PRD 需求通常提取 25~35 个 SRC；明显偏离时自查是否漏提或过碎。
4. 非功能要求（性能、安全、日志、合规）也是需求点，必须提取为 SRC，不得只在 Spec 层"顺手"补 NFR。
5. 原文逐字保存到 `specs/<feature>/source-prd.md`，不得改写、概括、补充。

## 二、Intake：status 判定

| status | 含义 | 纪律 |
|--------|------|------|
| confirmed | PRD 原文明确要求 | 文本必须能在原文中找到对应表述 |
| assumed | 提取时推断的需求 | text 中必须注明推断依据（如"原文'安全的登录'推断为需要加密存储"），不得伪装成 confirmed |

## 三、Mapping：disposition 判定

| disposition | 含义 | 约束 |
|-------------|------|------|
| covered | 已转换为 Spec 需求 | requirementIds 必填且真实存在；acceptanceIds 填对应 AC（可部分列举，至少归属正确） |
| excluded | 明确不做 | 必须给 note 理由（范围外、后续迭代等）；不允许静默丢失 |
| pending | 待业务澄清 | 必须给 note 说明待澄清内容；禁止用 excluded 吞掉不确定项 |

判定纪律：

1. covered 必须真实对应——FR 只实现了 SRC 的一半属于映射造假，语义审查会拦截，这里不做语义判断。
2. 原始需求不在本轮范围时才用 excluded；不确定时一律 pending。
3. 每个 SRC 必须有且仅有一条 mapping，不得遗漏。

## 四、无依据新增（unsupported addition）

Spec 中的 FR/NFR 若无法追溯到任何 SRC：

- 属于 Agent 自行发明或推测的需求，Source Coverage Gate 将拒绝。
- 确属必要的新增（如审查过程发现的真实缺口），必须先补 PRD：把新需求写回原始需求并重跑 Intake，而不是放宽映射。
- 例外路径：明确由某条 confirmed SRC 推导出的合理细化（如 SRC"密码安全存储"推导出 NFR"使用 bcrypt"）应映射回该 SRC，视为 covered。

## 五、产物格式

`specs/<feature>/source-map.json`：

```json
{
  "feature": "login",
  "prdHash": "sha256-（source-prd.md 的哈希，由工具校验，Agent 留空或照抄上一次值）",
  "sources": [
    {
      "sourceId": "SRC-001",
      "text": "连续 5 次密码错误锁定 15 分钟",
      "status": "confirmed",
      "claimType": "functional",
      "loadBearing": true,
      "sourceRef": {
        "file": "source-prd.md",
        "lineStart": 3,
        "lineEnd": 3,
        "quote": "连续 5 次密码错误锁定 15 分钟"
      }
    }
  ],
  "mappings": [
    {
      "sourceId": "SRC-001",
      "requirementIds": ["FR-003"],
      "acceptanceIds": ["AC-009"],
      "disposition": "covered",
      "note": null
    }
  ]
}
```

- SRC-NNN 三位数字，全局唯一，按原文出现顺序编号。
- prdHash 以 validate-source-map.mjs 计算结果为准（`node sdd/tools/freeze-source-map.mjs` 可自动填充；未填充时 Gate 报 prd-hash 错误）。

## 六、Claim 元数据（EARS-P3）

每个 source 除 sourceId/text/status 外，必须携带：

| 字段 | 类型 | 说明 |
|------|------|------|
| `claimType` | 枚举 | `functional`（功能）/ `constraint`（约束）/ `exception`（例外）/ `non-goal`（非目标）/ `assumption`（假设）/ `decision`（决策） |
| `loadBearing` | 布尔 | 是否影响下游开发决策。否定性约束、非目标、关键数值、例外处理通常为 true |
| `sourceRef` | 对象 | `{ file, lineStart, lineEnd, quote }`，指向 source-prd.md 的原文位置 |

纪律：

1. `sourceRef.quote` 必须是 source-prd.md 中逐字存在的原文片段，行号区间 lineStart..lineEnd 拼接后必须包含该引文（确定性校验，不接受只填行号不引原文）。
2. `sourceRef.file` 固定为 `source-prd.md`。
3. 不能只提取功能需求：否定性约束（non-goal）、约束（constraint）、例外（exception）、关键数值与异常处理同样必须提取，且常为 loadBearing。
4. Gate A（Intake Preservation）会独立重读原文比对 SRC 台账，漏提会被拦下并要求补充。

## 七、AC 映射强制（EARS-P3）

disposition=covered 且 `loadBearing=true` 且 `claimType ∈ {functional, exception}` 时，mapping 的 acceptanceIds 不得为空——关键行为/例外条件必须进入可验收的 AC，否则 Source Coverage Gate 拒绝。
