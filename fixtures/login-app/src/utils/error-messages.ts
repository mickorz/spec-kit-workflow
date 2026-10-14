export const ErrorMessages = {
  INVALID_CREDENTIALS: '用户名或密码错误',
  ACCOUNT_DISABLED: '账号已被禁用',
  ACCOUNT_LOCKED: '账号已锁定，请于 X 分钟后重试',
  ACCOUNT_LOCKED_PERMANENT: '账号已永久锁定，请联系管理员',
  VALIDATION_ERROR: '用户名和密码不能为空',
  FORBIDDEN: '无权限',
  TOKEN_EXPIRED: '登录已过期，请重新登录',
  TOKEN_REVOKED: '凭证已失效',
  TOKEN_INVALID: '凭证无效',
  ACCOUNT_NOT_FOUND: '账号不存在',
  INTERNAL_ERROR: '系统繁忙，请稍后重试',
  NO_TOKEN: '请提供认证凭证',
  RATE_LIMITED: '请求过于频繁，请稍后重试',
} as const;

export type ErrorCode = keyof typeof ErrorMessages;

export function accountLockedMessage(minutes: number): string {
  return `账号已锁定，请于 ${minutes} 分钟后重试`;
}
