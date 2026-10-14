export const meta = {
  name: 'sdd_review_integration_test',
  description: 'P0.6-B 集成测试：验证新 Reviewer prompt 生成完整 verifications'
}

const feature = 'login'
const dir = `specs/${feature}`
const appDir = `fixtures/${feature}-app`

// 1. 重新运行 Test Runner（生成含 testResults 的 evidence.json）
phase('Test')
const testOk = await commandSuccess(
  `node sdd/tools/run-tests.mjs ${feature} 99`,
  600000
)
log(`Test Runner 执行${testOk ? '成功' : '出错'}`)
await check(() => testOk, 'Test Runner 脚本自身异常')
await check(() => fileExists(`${dir}/evidence.json`), 'evidence.json 不存在')

// 2. Reviewer Agent（新 prompt 生成含 verifications 的 review.json）
phase('Review')
const reviewPrompt = `你是独立的 Reviewer Agent。你的职责是审查代码是否真正实现了 Spec 中的每条需求。

读取以下文件：
1. ${dir}/spec.md —— 需求规格（批准后的真相源）
2. ${dir}/evidence.json —— 测试结果（含 testResults 逐测试详情）
3. ${appDir}/src/ 目录下的所有源码文件
4. ${appDir}/tests/ 目录下的所有测试文件

审查要求：
- 必须逐条检查 spec.md 中的每个 FR 和 NFR。
- 不要信任 tasks.md 中的 done 标记或 Implement Agent 的总结。
- 必须阅读真实代码，判断每条需求是否被正确实现。
- 必须检查测试是否覆盖了每条需求的验收条件（AC）。
- 对于每个 AC，必须在 verifications 中填写验证方式：
  - automated_test：必须提供 testId（测试名称），该 testId 必须在 evidence.json 的 testResults 中存在。
  - static_check：必须提供 reason 和 fileRef（指向具体文件:行号，如 src/services/bcrypt-hasher.ts:15）。
  - manual：必须提供 reason 和 approver（审批人标识，如 "code-reviewer-zhang"）。无审批人则标记 unverified。
- 没有充分证据的 AC 应标记为 unverified，不能默认 pass。

审查状态枚举：
- pass：需求已正确实现，每个 AC 有验证证据。
- partial：部分实现，有缺口（说明缺了什么）。
- missing：完全未实现（代码中找不到相关逻辑）。
- contradicts：实现与 Spec 矛盾（说明矛盾点）。
- unverified：代码看起来正确，但没有充分的测试证据。

在 ${dir}/review.json 写入审查结果，格式如下：

{
  "feature": "${feature}",
  "round": 99,
  "specHash": "",
  "reviewerLabel": "Reviewer-IntegrationTest",
  "requirements": [
    {
      "id": "FR-001",
      "status": "pass",
      "evidenceRefs": ["AC-001", "AC-002"],
      "verifications": [
        { "ac": "AC-001", "type": "automated_test", "testId": "login success returns token", "result": "passed" },
        { "ac": "AC-002", "type": "automated_test", "testId": "login wrong password fails", "result": "passed" }
      ],
      "finding": null
    },
    {
      "id": "NFR-001",
      "status": "pass",
      "evidenceRefs": [],
      "verifications": [
        { "ac": null, "type": "static_check", "testId": null, "result": "passed", "reason": "bcrypt cost factor 10 在 BcryptHasher 中确认", "fileRef": "src/services/bcrypt-hasher.ts:15" }
      ],
      "finding": null
    }
  ]
}

注意：
- requirements 数组必须包含 spec.md 中的所有 FR 和 NFR，不能遗漏。
- status 非 pass 时 finding 必须非空。
- status=pass 时每个 AC 必须有对应的 verification 条目。
- automated_test 的 testId 必须是 evidence.json testResults 中真实存在的测试名称。
- static_check 必须包含 fileRef（文件:行号引用）。
- manual 必须包含 approver（审批人标识）。
- specHash 留空字符串，由工具填充。
- 只写 review.json，不要修改其他文件。
禁止调用 workflow 工具。`

const review = await agent(reviewPrompt, {
  label: 'Review-IntegrationTest',
  agentType: 'general',
  timeoutMs: 3600000
})
await check(() => review !== null, 'Review 失败')
await check(() => fileExists(`${dir}/review.json`), 'review.json 不存在')

// 3. 填充 specHash
await check(
  () => commandSuccess(`node sdd/tools/freeze-review.mjs ${feature}`, 30000),
  'review.json specHash 填充失败'
)

// 4. validate-review 结构校验
await check(
  () => commandSuccess(`node sdd/tools/validate-review.mjs ${feature} 99`, 30000),
  'review.json 结构校验失败'
)

// 5. is-converged strict 模式
phase('Converge')
const isConverged = await commandSuccess(
  `node sdd/tools/is-converged.mjs ${feature} 99`,
  30000
)

if (isConverged) {
  log('集成测试通过：Reviewer 生成了完整 verifications，C4 strict 通过')
} else {
  log('集成测试：未收敛（检查 C4 details 确认是否为 verifications 问题）')
}

return {
  feature,
  converged: isConverged,
  output: `集成测试${isConverged ? '通过' : '未收敛'}`
}
