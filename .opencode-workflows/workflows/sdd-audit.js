export const meta = {
  name: 'sdd_audit',
  description: 'Spec ↔ Code 实现一致性审计（只验证不修复）'
}

// 审计模式工作流：
// 输入: specPath + projectPath → 输出: 逐需求审查报告
// 不修改目标业务代码，不依赖 tasks.md/traceability.json
// P0-D 只读保护：审计前备份源码，审计后检测修改并恢复

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

// === Step 2: 代码快照 + 备份（Before）===
phase('代码快照')
const beforeSnapshot = `${outputDir}/snapshot-before.json`
const backupDir = `${outputDir}/source-backup`
await check(
  () => commandSuccess(
    `node sdd/tools/snapshot.mjs snapshot ${projectPath} ${beforeSnapshot}`,
    30000
  ),
  '代码快照（Before）失败'
)
await check(
  () => commandSuccess(
    `node sdd/tools/snapshot.mjs backup ${projectPath} ${backupDir}`,
    30000
  ),
  '代码备份失败'
)
log('代码快照 + 备份（Before）完成')

// === Step 3: 运行测试获取证据 ===
phase('测试执行')
const testOk = await commandSuccess(
  `node sdd/tools/audit-run-tests.mjs ${projectPath} ${outputDir}`,
  600000
)
await check(() => testOk, '测试执行器异常')
await check(() => fileExists(`${outputDir}/evidence.json`), 'evidence.json 不存在')
log('测试执行完成')

// === Step 4: Reviewer Agent 独立审查 ===
phase('Reviewer 审查')
const reviewPrompt = `你是独立的审计 Reviewer。你的职责是逐条核对 Spec 中的每条需求是否在代码中真正实现。

**重要：你不得修改任何源代码文件。你只能读取文件并写入 review.json。**

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
  - static_check：必须含 reason 和 fileRef（文件:行号，如 src/services/lockout-service.ts:50）。
  - manual：必须含 reason 和 approver。
- 没有充分证据的 AC 标记 unverified。
- 检查实现行为是否与 Spec 描述一致，不一致标记 contradicts。

审查状态枚举：
- pass：需求已正确实现，每个 AC 有验证证据。
- partial：部分实现，有缺口（说明缺了什么）。
- missing：完全未实现（代码中找不到相关逻辑）。
- contradicts：实现与 Spec 矛盾（说明矛盾点）。
- unverified：代码看起来正确，但没有充分的测试证据。

在 ${outputDir}/review.json 写入审查结果，格式如下：

{
  "feature": "${feature}",
  "round": 1,
  "specHash": "",
  "reviewerLabel": "Audit-Reviewer",
  "requirements": [
    {
      "id": "FR-001",
      "status": "pass",
      "evidenceRefs": ["AC-001", "AC-002"],
      "verifications": [
        { "ac": "AC-001", "type": "automated_test", "testId": "测试名称", "result": "passed" },
        { "ac": "AC-002", "type": "static_check", "result": "passed", "reason": "验证说明", "fileRef": "src/auth.ts:15" }
      ],
      "finding": null
    },
    {
      "id": "NFR-001",
      "status": "pass",
      "evidenceRefs": [],
      "verifications": [
        { "ac": null, "type": "static_check", "result": "passed", "reason": "验证说明", "fileRef": "src/config.ts:10" }
      ],
      "finding": null
    }
  ]
}

注意：
- requirements 数组必须包含 spec.md 中的所有 FR 和 NFR，不能遗漏。
- status 非 pass 时 finding 必须非空，说明具体缺口。
- status=pass 时必须有非空 verifications 数组，每个 AC 都要有对应条目。
- NFR 无 AC 时也必须有至少一条 verification（static_check 或 manual）。
- 所有支撑 pass 的 verification 必须有 result=passed。
- automated_test 的 testId 必须是 evidence.json testResults 中真实存在的测试名称。
- static_check 必须包含 fileRef（文件:行号引用）。
- specHash 留空字符串。
- 只写入 ${outputDir}/review.json，不要修改其他文件。
禁止调用 workflow 工具。
禁止修改 ${projectPath}/src/ 和 ${projectPath}/tests/ 下的任何文件。`

const review = await agent(reviewPrompt, {
  label: 'Audit-Reviewer',
  agentType: 'general',
  timeoutMs: 3600000
})
await check(() => review !== null, 'Reviewer 审查失败')
await check(() => fileExists(`${outputDir}/review.json`), 'review.json 不存在')
log('Reviewer 审查完成')

// === Step 4.5: 代码完整性检测（P0-D 只读保护）===
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
  log('代码完整性校验失败：源代码在审计过程中被修改，正在恢复...')
  await check(
    () => commandSuccess(
      `node sdd/tools/snapshot.mjs restore ${backupDir} ${projectPath}`,
      30000
    ),
    '源码恢复失败'
  )
  log('源码已从备份恢复（Reviewer 修改已撤销）')
} else {
  log('代码完整性校验通过：源代码未被修改')
}

// === Step 5: 审计收敛判定 ===
phase('收敛判定')
const convergeOk = await commandSuccess(
  `node sdd/tools/audit-converge.mjs ${specPath} ${outputDir}/review.json ${outputDir}/evidence.json ${projectPath} ${outputDir}`,
  30000
)
// convergeOk=false 表示存在缺口，不是工具异常
const auditReport = `${outputDir}/audit-report.json`
await check(() => fileExists(auditReport), '审计报告未生成')

if (convergeOk) {
  log('审计结果：全部需求通过')
} else {
  log('审计结果：存在缺口（详见 audit-report.json）')
}

// === 输出 ===
const finalConverged = convergeOk && codeUnchanged
const status = finalConverged ? 'passed' : 'issues-found'
log(`审计结束：${status}`)

return {
  feature,
  specPath,
  projectPath,
  outputDir,
  converged: finalConverged,
  codeUnchanged,
  status,
  output: `${feature} 审计${finalConverged ? '通过' : '发现缺口'}${codeUnchanged ? '' : '（代码被修改，已恢复）'}`
}
