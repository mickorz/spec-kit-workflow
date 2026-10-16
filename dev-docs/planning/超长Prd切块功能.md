没有全部实现。 我刚重新检查了 [spec-kit-workflow](https://github.com/mickorz/spec-kit-workflow?utm_source=chatgpt.com) 的最新 `master` 分支，发现你已经完成了 EARS-P3 Claim Preservation，但超长 PRD 所需的自动切块、逐块提取和跨块合并还没有实现。

当前最新提交：[`ac92702`](https://github.com/mickorz/spec-kit-workflow/commit/ac92702c8748372fa1f1b8a321a12cf06b27bd15?utm_source=chatgpt.com)。

## 一、8 个步骤逐项检查

| 流程                 | 当前状态        | 实现情况                                       |
| ------------------ | ----------- | ------------------------------------------ |
| 1. 超长 PRD 输入       | &#x20;部分支持  | 接受 `goal` 文本，但没有专门的超长文档加载机制                |
| 2. 按章节自动切块（程序）     | &#x20;未实现   | 未发现章节解析、Chunk 生成、Token 预算控制工具              |
| 3. LLM 逐块语义分析      | &#x20;未实现   | 现在由单个 Intake Agent 阅读整体输入                  |
| 4. 提取原子 Claim（SRC） | &#x20;已实现   | Intake Agent 提取 `SRC-NNN`，保存 Claim 类型和原文位置 |
| 5. 合并、去重、处理冲突      | &#x20;部分支持  | 有 ID 唯一性和语义审查，但没有独立的跨块 Claim 合并流程          |
| 6. 独立 LLM 对照原文检查漏提 | &#x20;已实现   | P3 新增 Gate A：Intake Preservation Reviewer  |
| 7. 生成完整 Claim 清单   | &#x20;已实现机制 | `source-map.json` 保存 SRC 台账；完整性仍依赖 LLM 审查  |
| 8. EARS → Spec     | &#x20;已实现   | Specify Agent + EARS 格式/语义门禁 + Gate B      |

说明：这里的“已实现”表示代码流程已接入，不等于经过了真实超长 PRD 的端到端验证。P3 执行报告明确记录，LLM 端到端测试尚待完成。

## 二、当前实际执行的流程

\#chatgpt-mermaid-\_r_92e\_{font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";font-size:16px;fill:rgb(13, 13, 13);}@keyframes edge-animation-frame{from{stroke-dashoffset:0;}}@keyframes dash{to{stroke-dashoffset:0;}}#chatgpt-mermaid-\_r_92e\_ .edge-animation-slow{stroke-dasharray:9,5!important;stroke-dashoffset:900;animation:dash 50s linear infinite;stroke-linecap:round;}#chatgpt-mermaid-\_r_92e\_ .edge-animation-fast{stroke-dasharray:9,5!important;stroke-dashoffset:900;animation:dash 20s linear infinite;stroke-linecap:round;}#chatgpt-mermaid-\_r_92e\_ .error-icon{fill:rgb(243, 243, 243);}#chatgpt-mermaid-\_r_92e\_ .error-text{fill:rgb(13, 13, 13);stroke:rgb(13, 13, 13);}#chatgpt-mermaid-\_r_92e\_ .edge-thickness-normal{stroke-width:1px;}#chatgpt-mermaid-\_r_92e\_ .edge-thickness-thick{stroke-width:3.5px;}#chatgpt-mermaid-\_r_92e\_ .edge-pattern-solid{stroke-dasharray:0;}#chatgpt-mermaid-\_r_92e\_ .edge-thickness-invisible{stroke-width:0;fill:none;}#chatgpt-mermaid-\_r_92e\_ .edge-pattern-dashed{stroke-dasharray:3;}#chatgpt-mermaid-\_r_92e\_ .edge-pattern-dotted{stroke-dasharray:2;}#chatgpt-mermaid-\_r_92e\_ .marker{fill:rgb(143, 143, 143);stroke:rgb(143, 143, 143);}#chatgpt-mermaid-\_r_92e\_ .marker.cross{stroke:rgb(143, 143, 143);}#chatgpt-mermaid-\_r_92e\_ svg{font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";font-size:16px;}#chatgpt-mermaid-\_r_92e\_ p{margin:0;}#chatgpt-mermaid-\_r_92e\_ .label{font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";color:rgb(13, 13, 13);}#chatgpt-mermaid-\_r_92e\_ .cluster-label text{fill:rgb(13, 13, 13);}#chatgpt-mermaid-\_r_92e\_ .cluster-label span{color:rgb(13, 13, 13);}#chatgpt-mermaid-\_r_92e\_ .cluster-label span p{background-color:transparent;}#chatgpt-mermaid-\_r_92e\_ .label text,#chatgpt-mermaid-\_r_92e\_ span{fill:rgb(13, 13, 13);color:rgb(13, 13, 13);}#chatgpt-mermaid-\_r_92e\_ .node rect,#chatgpt-mermaid-\_r_92e\_ .node circle,#chatgpt-mermaid-\_r_92e\_ .node ellipse,#chatgpt-mermaid-\_r_92e\_ .node polygon,#chatgpt-mermaid-\_r_92e\_ .node path{fill:rgb(222, 234, 251);stroke:rgb(83, 154, 248);stroke-width:1px;}#chatgpt-mermaid-\_r_92e\_ .rough-node .label text,#chatgpt-mermaid-\_r_92e\_ .node .label text,#chatgpt-mermaid-\_r_92e\_ .image-shape .label,#chatgpt-mermaid-\_r_92e\_ .icon-shape .label{text-anchor:middle;}#chatgpt-mermaid-\_r_92e\_ .node .katex path{fill:#000;stroke:#000;stroke-width:1px;}#chatgpt-mermaid-\_r_92e\_ .rough-node .label,#chatgpt-mermaid-\_r_92e\_ .node .label,#chatgpt-mermaid-\_r_92e\_ .image-shape .label,#chatgpt-mermaid-\_r_92e\_ .icon-shape .label{text-align:center;}#chatgpt-mermaid-\_r_92e\_ .node.clickable{cursor:pointer;}#chatgpt-mermaid-\_r_92e\_ .root .anchor path{fill:rgb(143, 143, 143)!important;stroke-width:0;stroke:rgb(143, 143, 143);}#chatgpt-mermaid-\_r_92e\_ .arrowheadPath{fill:rgb(143, 143, 143);}#chatgpt-mermaid-\_r_92e\_ .edgePath .path{stroke:rgb(143, 143, 143);stroke-width:1px;}#chatgpt-mermaid-\_r_92e\_ .flowchart-link{stroke:rgb(143, 143, 143);fill:none;}#chatgpt-mermaid-\_r_92e\_ .edgeLabel{background-color:rgb(252, 252, 252);text-align:center;}#chatgpt-mermaid-\_r_92e\_ .edgeLabel p{background-color:rgb(252, 252, 252);}#chatgpt-mermaid-\_r_92e\_ .edgeLabel rect{opacity:0.5;background-color:rgb(252, 252, 252);fill:rgb(252, 252, 252);}#chatgpt-mermaid-\_r_92e\_ .labelBkg{background-color:rgba(252, 252, 252, 0.5);}#chatgpt-mermaid-\_r_92e\_ .cluster rect{fill:rgb(243, 243, 243);stroke:rgba(0, 0, 0, 0.1);stroke-width:1px;}#chatgpt-mermaid-\_r_92e\_ .cluster text{fill:rgb(13, 13, 13);}#chatgpt-mermaid-\_r_92e\_ .cluster span{color:rgb(13, 13, 13);}#chatgpt-mermaid-\_r_92e\_ div.mermaidTooltip{position:absolute;text-align:center;max-width:200px;padding:2px;font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";font-size:12px;background:rgb(243, 243, 243);border:1px solid rgba(0, 0, 0, 0.1);border-radius:2px;pointer-events:none;z-index:100;}#chatgpt-mermaid-\_r_92e\_ .flowchartTitleText{text-anchor:middle;font-size:18px;fill:rgb(13, 13, 13);}#chatgpt-mermaid-\_r_92e\_ rect.text{fill:none;stroke-width:0;}#chatgpt-mermaid-\_r_92e\_ .icon-shape,#chatgpt-mermaid-\_r_92e\_ .image-shape{background-color:rgb(252, 252, 252);text-align:center;}#chatgpt-mermaid-\_r_92e\_ .icon-shape p,#chatgpt-mermaid-\_r_92e\_ .image-shape p{background-color:rgb(252, 252, 252);padding:2px;}#chatgpt-mermaid-\_r_92e\_ .icon-shape .label rect,#chatgpt-mermaid-\_r_92e\_ .image-shape .label rect{opacity:0.5;background-color:rgb(252, 252, 252);fill:rgb(252, 252, 252);}#chatgpt-mermaid-\_r_92e\_ .label-icon{display:inline-block;height:1em;overflow:visible;vertical-align:-0.125em;}#chatgpt-mermaid-\_r_92e\_ .node .label-icon path{fill:currentColor;stroke:revert;stroke-width:revert;}#chatgpt-mermaid-\_r_92e\_ .node .neo-node{stroke:rgb(83, 154, 248);}#chatgpt-mermaid-\_r_92e\_ [data-look="neo"].node rect,#chatgpt-mermaid-\_r_92e\_ [data-look="neo"].cluster rect,#chatgpt-mermaid-\_r_92e\_ [data-look="neo"].node polygon{stroke:url(#chatgpt-mermaid-\_r_92e\_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_92e\_ [data-look="neo"].swimlane.cluster rect{filter:none;}#chatgpt-mermaid-\_r_92e\_ [data-look="neo"].node path{stroke:url(#chatgpt-mermaid-\_r_92e\_-gradient);stroke-width:1px;}#chatgpt-mermaid-\_r_92e\_ [data-look="neo"].node .outer-path{filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_92e\_ [data-look="neo"].node .neo-line path{stroke:rgb(83, 154, 248);filter:none;}#chatgpt-mermaid-\_r_92e\_ [data-look="neo"].node circle{stroke:url(#chatgpt-mermaid-\_r_92e\_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_92e\_ [data-look="neo"].node circle .state-start{fill:#000000;}#chatgpt-mermaid-\_r_92e\_ [data-look="neo"].icon-shape .icon{fill:url(#chatgpt-mermaid-\_r_92e\_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_92e\_ [data-look="neo"].icon-shape .icon-neo path{stroke:url(#chatgpt-mermaid-\_r_92e\_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_92e\_ .node text{font-size:14px;font-weight:600;letter-spacing:normal;fill:rgb(0, 79, 153);}#chatgpt-mermaid-\_r_92e\_ .edgeLabels text{font-size:13px;font-weight:600;letter-spacing:-0.08px;fill:rgb(0, 79, 153);}#chatgpt-mermaid-\_r_92e\_ .node tspan[font-weight="normal"],#chatgpt-mermaid-\_r_92e\_ .edgeLabels tspan[font-weight="normal"]{font-weight:600;}#chatgpt-mermaid-\_r_92e\_ .edgeLabel .label rect{opacity:1;rx:13px;ry:13px;fill:rgb(245, 250, 255);stroke:rgb(206, 219, 229);stroke-width:1px;}#chatgpt-mermaid-\_r_92e\_ .node rect,#chatgpt-mermaid-\_r_92e\_ .node circle,#chatgpt-mermaid-\_r_92e\_ .node ellipse,#chatgpt-mermaid-\_r_92e\_ .node polygon,#chatgpt-mermaid-\_r_92e\_ .node path{fill:rgb(229, 243, 255);stroke:rgba(0, 0, 0, 0.1);stroke-width:1px;}#chatgpt-mermaid-\_r_92e\_ .node rect{rx:16px;ry:16px;}#chatgpt-mermaid-\_r_92e\_ .node.mermaid-decision .label-container{fill:rgb(245, 250, 255);stroke:rgb(206, 219, 229);stroke-dasharray:2,2;}#chatgpt-mermaid-\_r_92e\_ .edgePaths .flowchart-link{stroke:rgb(143, 143, 143);stroke-width:1px;stroke-linecap:round;stroke-linejoin:round;}#chatgpt-mermaid-\_r_92e\_ .marker{fill:rgb(143, 143, 143);stroke:rgb(143, 143, 143);}#chatgpt-mermaid-\_r_92e\_ :root{--mermaid-font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";}#chatgpt-mermaid-\_r_92e\_ .done rect{fill:rgb(220, 252, 231)!important;stroke:rgb(22, 163, 74)!important;color:rgb(22, 101, 52)!important;}#chatgpt-mermaid-\_r_92e\_ .done polygon{fill:rgb(220, 252, 231)!important;stroke:rgb(22, 163, 74)!important;color:rgb(22, 101, 52)!important;}#chatgpt-mermaid-\_r_92e\_ .done ellipse{fill:rgb(220, 252, 231)!important;stroke:rgb(22, 163, 74)!important;color:rgb(22, 101, 52)!important;}#chatgpt-mermaid-\_r_92e\_ .done circle{fill:rgb(220, 252, 231)!important;stroke:rgb(22, 163, 74)!important;color:rgb(22, 101, 52)!important;}#chatgpt-mermaid-\_r_92e\_ .done path{fill:rgb(220, 252, 231)!important;stroke:rgb(22, 163, 74)!important;color:rgb(22, 101, 52)!important;}#chatgpt-mermaid-\_r_92e\_ .done tspan{fill:rgb(22, 101, 52)!important;}#chatgpt-mermaid-\_r_92e\_ .missing rect{fill:rgb(254, 226, 226)!important;stroke:rgb(220, 38, 38)!important;color:rgb(153, 27, 27)!important;}#chatgpt-mermaid-\_r_92e\_ .missing polygon{fill:rgb(254, 226, 226)!important;stroke:rgb(220, 38, 38)!important;color:rgb(153, 27, 27)!important;}#chatgpt-mermaid-\_r_92e\_ .missing ellipse{fill:rgb(254, 226, 226)!important;stroke:rgb(220, 38, 38)!important;color:rgb(153, 27, 27)!important;}#chatgpt-mermaid-\_r_92e\_ .missing circle{fill:rgb(254, 226, 226)!important;stroke:rgb(220, 38, 38)!important;color:rgb(153, 27, 27)!important;}#chatgpt-mermaid-\_r_92e\_ .missing path{fill:rgb(254, 226, 226)!important;stroke:rgb(220, 38, 38)!important;color:rgb(153, 27, 27)!important;}#chatgpt-mermaid-\_r_92e\_ .missing tspan{fill:rgb(153, 27, 27)!important;}原始 PRD / goal单个 Intake Agent直接读取整个输入提取 SRC 原子 Claimsource-map.jsonGate A独立 LLM 检查漏提Specify Agent生成 FR / NFR / ACEARS 格式与语义校验Source MappingSRC → FR/NFR/ACSource Coverage结构校验Gate BClaim 语义保真检查Plan → Tasks → Implement

也就是说：当前的设计适合能够被 Agent 完整读取和处理的普通 PRD，但还不是专门面向几十万字 PRD 的分块提取架构。

## 三、缺失的部分，具体在哪些代码中？

目前关键入口是 [`sdd-feature.js`](https://github.com/mickorz/spec-kit-workflow/blob/master/.opencode-workflows/workflows/sdd-feature.js?utm_source=chatgpt.com)。

现在的 Intake 大致这样运行：

```
const goal = args.goal

const intake = await agent(
  `你是需求 Intake Agent。

   原始需求：
   ${goal}

   从原始需求中逐条提取需求点，
   为每条分配 SRC-NNN。
  `,
  { label: 'Intake', agentType: 'general' }
)
```

这意味着：

整个 `goal` 一次性交给单个 LLM Agent，没有程序先将长文档分成若干独立章节块。

你的 P3 已经新增了两个很有价值的阶段：

- Gate A：独立 Reviewer 重新阅读原始 PRD，检查 SRC 是否漏提，并允许最多两轮补漏。
- Gate B：对照 SRC 与 Spec，检查数值错误、条件遗漏和语义矛盾。

但 Gate A 同样要求 Reviewer 通读原始文档。对于特别长的 PRD，它也会遇到上下文容量、注意力分散和审查质量的问题。

此外，仓库中的 [`EARS-P5 执行文档`](https://github.com/mickorz/spec-kit-workflow/blob/master/dev-docs/planning/EARS%E6%94%B9%E9%80%A0-P5-%E6%89%A7%E8%A1%8C%E6%96%87%E6%A1%A3.md?utm_source=chatgpt.com) 已经规划了大 PRD 分批 Preservation Review，不过目前标记为待执行，而且它主要计划分批审查已有 SRC，并不是在 Intake 之前自动切块提取原始需求。

## 四、我建议接下来补什么？

重点不是重做 P3，而是在 Intake 前新增一个 Large PRD Processing 阶段。

\#chatgpt-mermaid-\_r_934\_{font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";font-size:16px;fill:rgb(13, 13, 13);}@keyframes edge-animation-frame{from{stroke-dashoffset:0;}}@keyframes dash{to{stroke-dashoffset:0;}}#chatgpt-mermaid-\_r_934\_ .edge-animation-slow{stroke-dasharray:9,5!important;stroke-dashoffset:900;animation:dash 50s linear infinite;stroke-linecap:round;}#chatgpt-mermaid-\_r_934\_ .edge-animation-fast{stroke-dasharray:9,5!important;stroke-dashoffset:900;animation:dash 20s linear infinite;stroke-linecap:round;}#chatgpt-mermaid-\_r_934\_ .error-icon{fill:rgb(243, 243, 243);}#chatgpt-mermaid-\_r_934\_ .error-text{fill:rgb(13, 13, 13);stroke:rgb(13, 13, 13);}#chatgpt-mermaid-\_r_934\_ .edge-thickness-normal{stroke-width:1px;}#chatgpt-mermaid-\_r_934\_ .edge-thickness-thick{stroke-width:3.5px;}#chatgpt-mermaid-\_r_934\_ .edge-pattern-solid{stroke-dasharray:0;}#chatgpt-mermaid-\_r_934\_ .edge-thickness-invisible{stroke-width:0;fill:none;}#chatgpt-mermaid-\_r_934\_ .edge-pattern-dashed{stroke-dasharray:3;}#chatgpt-mermaid-\_r_934\_ .edge-pattern-dotted{stroke-dasharray:2;}#chatgpt-mermaid-\_r_934\_ .marker{fill:rgb(143, 143, 143);stroke:rgb(143, 143, 143);}#chatgpt-mermaid-\_r_934\_ .marker.cross{stroke:rgb(143, 143, 143);}#chatgpt-mermaid-\_r_934\_ svg{font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";font-size:16px;}#chatgpt-mermaid-\_r_934\_ p{margin:0;}#chatgpt-mermaid-\_r_934\_ .label{font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";color:rgb(13, 13, 13);}#chatgpt-mermaid-\_r_934\_ .cluster-label text{fill:rgb(13, 13, 13);}#chatgpt-mermaid-\_r_934\_ .cluster-label span{color:rgb(13, 13, 13);}#chatgpt-mermaid-\_r_934\_ .cluster-label span p{background-color:transparent;}#chatgpt-mermaid-\_r_934\_ .label text,#chatgpt-mermaid-\_r_934\_ span{fill:rgb(13, 13, 13);color:rgb(13, 13, 13);}#chatgpt-mermaid-\_r_934\_ .node rect,#chatgpt-mermaid-\_r_934\_ .node circle,#chatgpt-mermaid-\_r_934\_ .node ellipse,#chatgpt-mermaid-\_r_934\_ .node polygon,#chatgpt-mermaid-\_r_934\_ .node path{fill:rgb(222, 234, 251);stroke:rgb(83, 154, 248);stroke-width:1px;}#chatgpt-mermaid-\_r_934\_ .rough-node .label text,#chatgpt-mermaid-\_r_934\_ .node .label text,#chatgpt-mermaid-\_r_934\_ .image-shape .label,#chatgpt-mermaid-\_r_934\_ .icon-shape .label{text-anchor:middle;}#chatgpt-mermaid-\_r_934\_ .node .katex path{fill:#000;stroke:#000;stroke-width:1px;}#chatgpt-mermaid-\_r_934\_ .rough-node .label,#chatgpt-mermaid-\_r_934\_ .node .label,#chatgpt-mermaid-\_r_934\_ .image-shape .label,#chatgpt-mermaid-\_r_934\_ .icon-shape .label{text-align:center;}#chatgpt-mermaid-\_r_934\_ .node.clickable{cursor:pointer;}#chatgpt-mermaid-\_r_934\_ .root .anchor path{fill:rgb(143, 143, 143)!important;stroke-width:0;stroke:rgb(143, 143, 143);}#chatgpt-mermaid-\_r_934\_ .arrowheadPath{fill:rgb(143, 143, 143);}#chatgpt-mermaid-\_r_934\_ .edgePath .path{stroke:rgb(143, 143, 143);stroke-width:1px;}#chatgpt-mermaid-\_r_934\_ .flowchart-link{stroke:rgb(143, 143, 143);fill:none;}#chatgpt-mermaid-\_r_934\_ .edgeLabel{background-color:rgb(252, 252, 252);text-align:center;}#chatgpt-mermaid-\_r_934\_ .edgeLabel p{background-color:rgb(252, 252, 252);}#chatgpt-mermaid-\_r_934\_ .edgeLabel rect{opacity:0.5;background-color:rgb(252, 252, 252);fill:rgb(252, 252, 252);}#chatgpt-mermaid-\_r_934\_ .labelBkg{background-color:rgba(252, 252, 252, 0.5);}#chatgpt-mermaid-\_r_934\_ .cluster rect{fill:rgb(243, 243, 243);stroke:rgba(0, 0, 0, 0.1);stroke-width:1px;}#chatgpt-mermaid-\_r_934\_ .cluster text{fill:rgb(13, 13, 13);}#chatgpt-mermaid-\_r_934\_ .cluster span{color:rgb(13, 13, 13);}#chatgpt-mermaid-\_r_934\_ div.mermaidTooltip{position:absolute;text-align:center;max-width:200px;padding:2px;font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";font-size:12px;background:rgb(243, 243, 243);border:1px solid rgba(0, 0, 0, 0.1);border-radius:2px;pointer-events:none;z-index:100;}#chatgpt-mermaid-\_r_934\_ .flowchartTitleText{text-anchor:middle;font-size:18px;fill:rgb(13, 13, 13);}#chatgpt-mermaid-\_r_934\_ rect.text{fill:none;stroke-width:0;}#chatgpt-mermaid-\_r_934\_ .icon-shape,#chatgpt-mermaid-\_r_934\_ .image-shape{background-color:rgb(252, 252, 252);text-align:center;}#chatgpt-mermaid-\_r_934\_ .icon-shape p,#chatgpt-mermaid-\_r_934\_ .image-shape p{background-color:rgb(252, 252, 252);padding:2px;}#chatgpt-mermaid-\_r_934\_ .icon-shape .label rect,#chatgpt-mermaid-\_r_934\_ .image-shape .label rect{opacity:0.5;background-color:rgb(252, 252, 252);fill:rgb(252, 252, 252);}#chatgpt-mermaid-\_r_934\_ .label-icon{display:inline-block;height:1em;overflow:visible;vertical-align:-0.125em;}#chatgpt-mermaid-\_r_934\_ .node .label-icon path{fill:currentColor;stroke:revert;stroke-width:revert;}#chatgpt-mermaid-\_r_934\_ .node .neo-node{stroke:rgb(83, 154, 248);}#chatgpt-mermaid-\_r_934\_ [data-look="neo"].node rect,#chatgpt-mermaid-\_r_934\_ [data-look="neo"].cluster rect,#chatgpt-mermaid-\_r_934\_ [data-look="neo"].node polygon{stroke:url(#chatgpt-mermaid-\_r_934\_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_934\_ [data-look="neo"].swimlane.cluster rect{filter:none;}#chatgpt-mermaid-\_r_934\_ [data-look="neo"].node path{stroke:url(#chatgpt-mermaid-\_r_934\_-gradient);stroke-width:1px;}#chatgpt-mermaid-\_r_934\_ [data-look="neo"].node .outer-path{filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_934\_ [data-look="neo"].node .neo-line path{stroke:rgb(83, 154, 248);filter:none;}#chatgpt-mermaid-\_r_934\_ [data-look="neo"].node circle{stroke:url(#chatgpt-mermaid-\_r_934\_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_934\_ [data-look="neo"].node circle .state-start{fill:#000000;}#chatgpt-mermaid-\_r_934\_ [data-look="neo"].icon-shape .icon{fill:url(#chatgpt-mermaid-\_r_934\_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_934\_ [data-look="neo"].icon-shape .icon-neo path{stroke:url(#chatgpt-mermaid-\_r_934\_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_934\_ .node text{font-size:14px;font-weight:600;letter-spacing:normal;fill:rgb(0, 79, 153);}#chatgpt-mermaid-\_r_934\_ .edgeLabels text{font-size:13px;font-weight:600;letter-spacing:-0.08px;fill:rgb(0, 79, 153);}#chatgpt-mermaid-\_r_934\_ .node tspan[font-weight="normal"],#chatgpt-mermaid-\_r_934\_ .edgeLabels tspan[font-weight="normal"]{font-weight:600;}#chatgpt-mermaid-\_r_934\_ .edgeLabel .label rect{opacity:1;rx:13px;ry:13px;fill:rgb(245, 250, 255);stroke:rgb(206, 219, 229);stroke-width:1px;}#chatgpt-mermaid-\_r_934\_ .node rect,#chatgpt-mermaid-\_r_934\_ .node circle,#chatgpt-mermaid-\_r_934\_ .node ellipse,#chatgpt-mermaid-\_r_934\_ .node polygon,#chatgpt-mermaid-\_r_934\_ .node path{fill:rgb(229, 243, 255);stroke:rgba(0, 0, 0, 0.1);stroke-width:1px;}#chatgpt-mermaid-\_r_934\_ .node rect{rx:16px;ry:16px;}#chatgpt-mermaid-\_r_934\_ .node.mermaid-decision .label-container{fill:rgb(245, 250, 255);stroke:rgb(206, 219, 229);stroke-dasharray:2,2;}#chatgpt-mermaid-\_r_934\_ .edgePaths .flowchart-link{stroke:rgb(143, 143, 143);stroke-width:1px;stroke-linecap:round;stroke-linejoin:round;}#chatgpt-mermaid-\_r_934\_ .marker{fill:rgb(143, 143, 143);stroke:rgb(143, 143, 143);}#chatgpt-mermaid-\_r_934\_ :root{--mermaid-font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";}#chatgpt-mermaid-\_r_934\_ .new rect{fill:rgb(219, 234, 254)!important;stroke:rgb(37, 99, 235)!important;color:rgb(30, 64, 175)!important;}#chatgpt-mermaid-\_r_934\_ .new polygon{fill:rgb(219, 234, 254)!important;stroke:rgb(37, 99, 235)!important;color:rgb(30, 64, 175)!important;}#chatgpt-mermaid-\_r_934\_ .new ellipse{fill:rgb(219, 234, 254)!important;stroke:rgb(37, 99, 235)!important;color:rgb(30, 64, 175)!important;}#chatgpt-mermaid-\_r_934\_ .new circle{fill:rgb(219, 234, 254)!important;stroke:rgb(37, 99, 235)!important;color:rgb(30, 64, 175)!important;}#chatgpt-mermaid-\_r_934\_ .new path{fill:rgb(219, 234, 254)!important;stroke:rgb(37, 99, 235)!important;color:rgb(30, 64, 175)!important;}#chatgpt-mermaid-\_r_934\_ .new tspan{fill:rgb(30, 64, 175)!important;}#chatgpt-mermaid-\_r_934\_ .old rect{fill:rgb(220, 252, 231)!important;stroke:rgb(22, 163, 74)!important;color:rgb(22, 101, 52)!important;}#chatgpt-mermaid-\_r_934\_ .old polygon{fill:rgb(220, 252, 231)!important;stroke:rgb(22, 163, 74)!important;color:rgb(22, 101, 52)!important;}#chatgpt-mermaid-\_r_934\_ .old ellipse{fill:rgb(220, 252, 231)!important;stroke:rgb(22, 163, 74)!important;color:rgb(22, 101, 52)!important;}#chatgpt-mermaid-\_r_934\_ .old circle{fill:rgb(220, 252, 231)!important;stroke:rgb(22, 163, 74)!important;color:rgb(22, 101, 52)!important;}#chatgpt-mermaid-\_r_934\_ .old path{fill:rgb(220, 252, 231)!important;stroke:rgb(22, 163, 74)!important;color:rgb(22, 101, 52)!important;}#chatgpt-mermaid-\_r_934\_ .old tspan{fill:rgb(22, 101, 52)!important;}超长 PRD / GDD 文件新增：按章节、结构切块新增：分块派发 LLM 提取Claim新增：合并、去重、冲突检测现有：生成 SRC Ledger增强：Gate A按原文块独立复查现有：EARS Specify现有：Gate B 保真审查Plan / Tasks / Implement

建议按这个优先级落地：

1. P0：PRD Chunker。使用 Node.js 解析 Markdown 标题、章节、表格，按结构与 Token 预算切块，并记录原文位置。
2. P1：Chunk Intake。每块独立提取 Claim，使用临时局部 ID，避免并行 Agent 产生重复的全局 SRC ID。
3. P2：Claim Merge。合并各块结果，识别重复、互相矛盾和跨章节引用，最后统一分配 `SRC-NNN`。
4. P3：Chunk Coverage Audit。让独立 Reviewer 按原始 Chunk 逐块检查是否漏提，再交给现有 Gate A 和后续 Spec 链路。

## 五、最终判断

EARS-P2：来源映射与结构防遗漏

已实现

EARS-P3：Claim 逐条语义保真

已实现

EARS-P4：来源契约强化

待执行

EARS-P5：跨阶段与分批审核

待执行

超长 PRD 自动切块与分块提取

尚未实现

我的建议：下一步优先补超长 PRD 的 Chunking + Map-Reduce Claim Extraction 能力。

因为你现在的 P3 已经解决了「提取出来的 Claim 怎样审核」的问题，而超长 PRD 最大的剩余风险是：原始文档太长，单个 Intake Agent 根本没有稳定、完整地提取所有 Claim。

先解决这个输入层瓶颈，再继续强化后续 Gate，收益会更大。


# 超长 PRD 分块 Claim 提取与覆盖审计

**项目**：mickorz/spec-kit-workflow  
**模块名称**：Large PRD Intake  
**开发阶段**：LPRD-P0 ～ LPRD-P3  
**现有基础**：EARS-P3 Claim Preservation

## 一、需求目标

将现有的「单个 Intake Agent 读取整份 PRD」升级为：

原始超长 PRD → 结构化切块 → 分块 Claim 提取 → 全局合并去重 → 独立逐块漏提检查 → SRC Ledger → 现有 EARS Spec 流程。

核心目标是在长文档场景下，降低上下文溢出、需求漏提、跨章节冲突和重复提取的风险。

## 二、功能需求

**FR-001：文件输入与原文保护**

- 支持通过 `prdPath` 引用 Markdown PRD 文件。
- 保留原有 `args.goal` 短需求输入。
- 程序复制原文至 `source-prd.md`，不经过 LLM 改写。
- 使用 SHA256 保证原始来源与中间产物一致。

**FR-002：结构化自动切块**

- 优先按 Markdown 标题、章节、段落和逻辑块切分。
- 保护表格、嵌套列表、代码围栏等结构。
- 支持可配置的 Token 预算与上下文重叠。
- 保存每个 Chunk 的原文位置、章节路径和哈希。
- 禁止静默截断内容。

**FR-003：LLM 分块提取 Claim**

- 每个 Chunk 独立调用 Intake Agent。
- 每条 Claim 包含类型、原文证据、位置和局部 ID。
- 并行提取时先使用局部 ID，避免重复分配 SRC。
- 任一 Chunk 失败不得跳过，可有限重试。

**FR-004：Claim 合并与冲突分析**

- 聚合所有 Chunk 结果。
- 确定性检查完全重复，LLM 识别语义重复。
- 保留去重前的完整来源记录。
- 跨章节冲突必须报告，不允许自动猜测哪个版本正确。
- 合并完成后统一生成 `SRC-NNN`，写入现有 `source-map.json`。

**FR-005：独立逐块漏提审查**

- 使用只读 Reviewer 重新阅读原始 Chunk。
- 对照已提取的 Claim 识别遗漏。
- 对遗漏项进行定向补提。
- 复用 EARS-P3 的 Gate A 规则与 `intake-review.json` 契约。
- 全部 Chunk 通过且冲突解决后才能进入 Specify。

**FR-006：EARS 工作流集成**

- 在 `sdd_feature` 新增大文档模式。
- 复用现有 Specify、EARS 双门禁、Source Coverage、Gate B。
- 不再在大文档模式下把整个 PRD 拼接进 Prompt。
- 若最终 Claim 清单仍超出下游处理容量，明确阻断并保留中间结果，不允许截断后继续开发。

## 三、交付阶段

| 阶段 | 主要交付 | 验收重点 |
|---|---|---|
| LPRD-P0 | Chunker、Manifest、结构校验 | 原文完整覆盖、稳定切块 |
| LPRD-P1 | Chunk Intake、Merge/Reduce | 原子 Claim、去重、冲突处理 |
| LPRD-P2 | Chunk Gate A | 独立逐块检查漏提 |
| LPRD-P3 | 集成 `sdd_feature` | EARS 接入、端到端测试、容量门禁 |

## 四、关键产物

新增 `specs/<feature>/intake/`，包含：

- `manifest.json`：Chunk 清单、原文范围、哈希。
- `chunks/`：独立可读的文档块。
- `claims/`：每块的局部 Claim。
- `reviews/`：每块的独立漏提审查。
- `merge-report.json`：去重、合并、冲突记录。
- `run-report.json`：处理状态、错误、重试和成本统计。

继续使用现有的 `source-prd.md`、`source-map.json` 和 `intake-review.json` 作为正式来源产物。

## 五、核心验收要求

1. 长文档全部原文均有确定性的 Chunk 主覆盖范围，没有遗漏或静默截断。
2. 每条 Claim 都能追溯到原始 PRD 的真实引文。
3. 任一 Chunk 提取失败、审查缺失或冲突未解决时，总流程不能返回成功。
4. 人工注入的遗漏需求应能被独立 Reviewer 发现。
5. 原有 EARS-P0 至 P3 功能与测试不能回归。
6. 支持大文档 Claim 提取不等于无限长 Spec 生成；下游容量不足必须明确报告。

## 六、非目标

本期不处理 PDF、Word、图片 OCR，不修改 LLM 模型，不重写既有 EARS 链路，也不包含 EARS-P4 的审批机制和 P5 的代码审计扩展。

## 七、开发建议

优先完成 **LPRD-P0**：先验证超长 PRD 的结构化切块、原文完整性和 Chunk Manifest。

通过确定性测试后，再开发 LLM 分块提取与独立审查，避免一次性修改整个工作流导致问题难以定位。