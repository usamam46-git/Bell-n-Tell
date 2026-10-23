import { z } from 'zod';
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.url().startsWith('postgres'), API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  WEB_ORIGIN: z.url(), AUTH_HASH_KEY: z.string().min(32)
});
export function readEnv(source: NodeJS.ProcessEnv = process.env) {
  const result = schema.safeParse(source);
  if (!result.success) throw new Error(`Invalid server environment: ${result.error.issues.map((issue) => issue.path.join('.')).join(', ')}`);
  if (result.data.NODE_ENV === 'production' && !result.data.WEB_ORIGIN.startsWith('https://')) throw new Error('WEB_ORIGIN must use HTTPS in production');
  return result.data;
}
export type Env = ReturnType<typeof readEnv>;
