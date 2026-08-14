import { z } from 'zod';

export const profileInputSchema = z.object({
  nickname: z.string().trim().min(1, '请填写昵称').max(30),
  gender: z.enum(['male', 'female']),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  heightCm: z.number().min(120).max(230),
  weightKg: z.number().min(35).max(300),
  bodyFatPct: z.number().min(3).max(70).optional(),
  activityFactor: z.number().min(1.1).max(2.2),
  goal: z.enum(['cut', 'recomp', 'bulk']),
});

export function validateAiBaseUrl(value: string, production = import.meta.env.PROD): URL {
  const url = new URL(value.trim());
  if (url.username || url.password) throw new Error('地址不能包含账号或密码');
  if (production && url.protocol !== 'https:') throw new Error('正式环境只允许 HTTPS 地址');
  if (production && ['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
    throw new Error('正式环境不能连接本机地址');
  }
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('接口地址格式不受支持');
  return url;
}

export function safeErrorMessage(error: unknown): string {
  if (error instanceof TypeError && /fetch|network|load/i.test(error.message))
    return '网络连接失败，请稍后重试';
  if (error instanceof Error && /401|403/.test(error.message)) return '登录或接口权限已失效，请重新验证';
  if (error instanceof Error && /429/.test(error.message)) return '请求过于频繁，请稍后再试';
  return '操作失败，数据仍保存在本机，请稍后重试';
}
