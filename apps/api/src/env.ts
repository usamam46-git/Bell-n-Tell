import { z } from 'zod';
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.url().startsWith('postgres'), API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  WEB_ORIGIN: z.url(), AUTH_HASH_KEY: z.string().min(32),
  LIVE_AI_ENABLED:z.enum(['true','false']).default('false').transform(value=>value==='true'),
  OPENAI_API_KEY:z.string().min(20).optional(),
  OPENAI_REALTIME_MODEL:z.string().min(1).default('gpt-realtime-2.1-mini'),
  LIVE_OPERATOR_TIMEZONE:z.string().min(1).default('Asia/Karachi')
});
export function readEnv(source: NodeJS.ProcessEnv = process.env) {
  const result = schema.safeParse(source);
  if (!result.success) throw new Error(`Invalid server environment: ${result.error.issues.map((issue) => issue.path.join('.')).join(', ')}`);
  if (result.data.NODE_ENV === 'production' && !result.data.WEB_ORIGIN.startsWith('https://')) throw new Error('WEB_ORIGIN must use HTTPS in production');
  if(result.data.LIVE_AI_ENABLED&&!result.data.OPENAI_API_KEY)throw new Error('OPENAI_API_KEY is required when LIVE_AI_ENABLED=true');
  if(result.data.LIVE_AI_ENABLED&&result.data.OPENAI_REALTIME_MODEL!=='gpt-realtime-2.1-mini')throw new Error('OPENAI_REALTIME_MODEL requires a reviewed rate snapshot before live enablement');
  try{new Intl.DateTimeFormat('en',{timeZone:result.data.LIVE_OPERATOR_TIMEZONE});}catch{throw new Error('LIVE_OPERATOR_TIMEZONE must be an IANA timezone');}
  return result.data;
}
export type Env = ReturnType<typeof readEnv>;
