import { z } from 'zod';

export const loginSchema = z.object({
  username: z.string().min(1, '用户名和密码不能为空'),
  password: z.string().min(1, '用户名和密码不能为空'),
});

export type LoginInput = z.infer<typeof loginSchema>;

export function validateLoginInput(body: unknown): { success: true; data: LoginInput } | { success: false; error: string } {
  const result = loginSchema.safeParse(body);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: '用户名和密码不能为空' };
}
