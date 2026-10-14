export const meta = {
  name: 'experiment_a0',
  description: 'A/B 实验 A0：Spec → Coding 一次完成'
}

const runDir = args.runDir
const specFile = args.specFile || `${runDir}/spec.md`
const appDir = `${runDir}/app`

await check(() => typeof runDir === 'string' && runDir.length > 0, '需要 runDir 参数')

// A0：单个 Agent 读取 Spec，一次性实现全部代码和测试
phase('Coding')
const impl = await agent(
  `读取 ${specFile}（需求规格）。
在 ${appDir}/ 目录下实现全部功能和测试。

要求：
1. 在 ${appDir}/src/auth.ts 中实现 spec 末尾"公共 API 契约"定义的全部接口。
2. 在 ${appDir}/tests/ 目录下编写你自己的单元测试。
3. 确保 package.json 的 test 脚本可以运行测试（使用 vitest）。
4. 实现所有 FR-001 到 FR-007 和 NFR-001 到 NFR-005 的需求。
5. 审计日志必须包含来源 IP 字段。
6. 密码必须使用带盐慢哈希（bcrypt 或同等强度）。
7. 锁定阈值和时长必须可通过 updateLockConfig 动态调整。
禁止调用 workflow 工具。`,
  { label: 'A0-Coding', agentType: 'general', timeoutMs: 3600000 }
)
await check(() => impl !== null, 'Coding 失败')

return { runDir, appDir, output: 'A0 coding 完成' }
