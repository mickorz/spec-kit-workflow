export const meta = {
  name: 'sdd_audit',
  description: 'Spec ↔ Code 实现一致性审计（只读 explore Reviewer + 宿主侧持久化）'
}

// P0.7.1 审计模式工作流：
// - Reviewer 使用 explore（只读），无 write 权限
// - Reviewer 输出 JSON 文本，宿主侧解析+持久化
// - 源码被修改时审计判 invalid，不采纳 Review 结论

const specPath = args.specPath
const projectPath = args.projectPath
const outputDir = args.outputDir || `audit-results/${args.feature || 'default'}`
const feature = args.feature || 'audit'

await check(
  () => typeof specPath === 'string' && specPath.length > 0 &&
        typeof projectPath === 'string' && projectPath.length > 0,
  '需要 specPath 和 projectPath 参数'
)

log(`审计启动: spec=${specPath}, project=${projectPath}, output=${outputDir}`)

// === Step 1: 解析 Spec 需求 ===
phase('Spec 解析')
await check(
  () => commandSuccess(`node sdd/tools/audit-spec-parse.mjs ${specPath}`, 30000),
  'Spec 解析失败'
)
log('Spec 需求提取完成')

// === Step 2: 代码快照（Before）===
phase('代码快照')
const beforeSnapshot = `${outputDir}/snapshot-before.json`
await check(
  () => commandSuccess(
    `node sdd/tools/snapshot.mjs snapshot ${projectPath} ${beforeSnapshot}`,
    30000
  ),
  '代码快照（Before）失败'
)
log('代码快照（Before）完成')

// === Step 3: 运行测试获取证据 ===
phase('测试执行')
const testOk = await commandSuccess(
  `node sdd/tools/audit-run-tests.mjs ${projectPath} ${outputDir}`,
  600000
)
await check(() => testOk, '测试执行器异常')
await check(() => fileExists(`${outputDir}/evidence.json`), 'evidence.json 不存在')
log('测试执行完成')

// === Step 4: Reviewer Agent 独立审查（explore 只读）===
phase('Reviewer 审查')
const reviewPrompt = `你是独立的审计 Reviewer。你的职责是逐条核对 Spec 中的每条需求是否在代码中真正实现。

你是只读 Reviewer，不能修改任何文件。你的回复必须只包含一个 JSON 对象，不要用 markdown 围栏，不要包含任何其他解释。

读取以下文件：
1. ${specPath} —— 需求规格（审查基准）
2. ${outputDir}/evidence.json —— 测试结果（含 testResults 逐测试详情）
3. ${projectPath}/src/ 目录下的所有源码文件
4. ${projectPath}/tests/ 目录下的所有测试文件

审查要求：
- 必须逐条检查 spec.md 中的每个 FR 和 NFR。
- 必须阅读真实代码，判断每条需求是否被正确实现。
- 不要信任 tasks.md 或其他标记，只信任代码本身。
- 不要因为测试全部通过就认为所有需求已实现——测试可能不完整。
- 对每个 AC，必须在 verifications 中填写验证方式：
  - automated_test：testId 必须在 evidence.json 的 testResults 中存在且状态为 passed。
  - static_check：必须含 reason 和 fileRef（文件:行号，如 src/auth.ts:50）。
  - manual：必须含 reason 和 approver。
- 没有充分证据的 AC 标记 unverified。

审查状态判定规则（严格遵循）：
- pass：需求已正确实现，每个 AC 有验证证据。
- partial：部分实现，有缺口。代码中存在相关逻辑但不完整，缺少某些 AC 的实现。
- missing：完全未实现。代码中找不到任何相关逻辑。
- contradicts：实现与 Spec 矛盾。代码中存在实现，但行为与 Spec 描述冲突。
  举例：Spec 要求阈值=5，代码中阈值=10，是 contradicts（不是 partial）。
  举例：Spec 要求错误消息是"登录失败"，代码返回"密码错误"，是 contradicts。
  举例：Spec 要求加密存储，代码明文存储，是 contradicts。
- unverified：代码看起来正确，但没有充分的测试证据。

关键区分：
- 值不匹配（参数、阈值、消息文案与 Spec 不一致）= contradicts
- 功能部分缺失（有框架但缺关键逻辑）= partial
- 功能完全不存在 = missing

你的回复必须是以下 JSON 格式（纯 JSON，不要 markdown 围栏）：

{"feature":"${feature}","round":1,"specHash":"","reviewerLabel":"Audit-Reviewer","requirements":[{"id":"FR-001","status":"pass","evidenceRefs":["AC-001"],"verifications":[{"ac":"AC-001","type":"automated_test","testId":"测试名称","result":"passed"}],"finding":null},{"id":"NFR-001","status":"pass","evidenceRefs":[],"verifications":[{"ac":null,"type":"static_check","result":"passed","reason":"验证说明","fileRef":"src/config.ts:10"}],"finding":null}]}

注意：
- requirements 数组必须包含 spec.md 中中的所有 FR 和 NFR，不能遗漏。
- status 非 pass 时 finding 必须非空，说明具体缺口。
- status=pass 时必须有非空 verifications 数组，每个 AC 都要有对应条目。
- NFR 无 AC 时也必须有至少一条 verification。
- 所有支撑 pass 的 verification 必须有 result=passed。
- automated_test 的 testId 必须是 evidence.json testResults 中真实存在的测试名称。
- static_check 必须包含 fileRef。`

const reviewText = await agent(reviewPrompt, {
  label: 'Audit-Reviewer',
  agentType: 'explore',
  timeoutMs: 3600000
})
await check(() => reviewText !== null, 'Reviewer 审查失败')
log('Reviewer 审查完成（explore 只读）')

// === Step 4.5: 宿主侧持久化 review.json（从 journal 提取）===
phase('审查结果持久化')
// extract-review.mjs 从工作流 journal 提取 Reviewer 的 JSON 输出，写入 review.json
// 避免 commandSuccess 使用 cmd.exe（非 PowerShell）导致的命令兼容性问题
await check(
  () => commandSuccess(
    `node sdd/tools/extract-review.mjs ${outputDir}/review.json`
  ),
  'review.json 提取失败'
)
await check(() => fileExists(`${outputDir}/review.json`), 'review.json 不存在')
log('review.json 已从 journal 提取并持久化')

// === Step 5: 代码完整性检测 ===
phase('代码完整性检测')
const afterSnapshot = `${outputDir}/snapshot-after.json`
await check(
  () => commandSuccess(
    `node sdd/tools/snapshot.mjs snapshot ${projectPath} ${afterSnapshot}`,
    30000
  ),
  '代码快照（After）失败'
)

const codeUnchanged = await commandSuccess(
  `node sdd/tools/snapshot.mjs compare ${beforeSnapshot} ${afterSnapshot}`,
  30000
)

if (!codeUnchanged) {
  log('代码完整性校验失败：源代码在审计过程中被修改')
  log('审计结果标记为 invalid，不采纳本次 Review 结论')
  return {
    feature,
    specPath,
    projectPath,
    outputDir,
    converged: false,
    codeUnchanged: false,
    status: 'invalid',
    output: `${feature} 审计无效（源代码被修改，Review 结论不可信）`
  }
}
log('代码完整性校验通过：源代码未被修改')

// === Step 6: 审计收敛判定 ===
phase('收敛判定')
const convergeOk = await commandSuccess(
  `node sdd/tools/audit-converge.mjs ${specPath} ${outputDir}/review.json ${outputDir}/evidence.json ${projectPath} ${outputDir}`,
  30000
)
const auditReport = `${outputDir}/audit-report.json`
await check(() => fileExists(auditReport), '审计报告未生成')

if (convergeOk) {
  log('审计结果：全部需求通过')
} else {
  log('审计结果：存在缺口（详见 audit-report.json）')
}

// === 输出 ===
const status = convergeOk ? 'passed' : 'issues-found'
log(`审计结束：${status}`)

return {
  feature,
  specPath,
  projectPath,
  outputDir,
  converged: convergeOk,
  codeUnchanged,
  status,
  output: `${feature} 审计${convergeOk ? '通过' : '发现缺口'}`
}
