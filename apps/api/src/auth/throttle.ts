import { sql, eq, and } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { securityThrottles } from '../db/schema.js';
import { keyedHash } from './crypto.js';

export async function consumeThrottle(db: Db, key: string, scope: string, subject: string, limit: number) {
  const now = Date.now();
  const windowStart = new Date(Math.floor(now / 900000) * 900000);
  const hashedSubjectKey = keyedHash(key, `throttle:${scope}`, subject);
  const [row] = await db.insert(securityThrottles).values({ scope, hashedSubjectKey, windowStart, count: 1 })
    .onConflictDoUpdate({ target: [securityThrottles.scope, securityThrottles.hashedSubjectKey, securityThrottles.windowStart], set: { count: sql`${securityThrottles.count} + 1` } }).returning();
  return row.count <= limit;
}
export async function clearThrottle(db: Db, key: string, scope: string, subject: string) {
  await db.delete(securityThrottles).where(and(eq(securityThrottles.scope, scope), eq(securityThrottles.hashedSubjectKey, keyedHash(key, `throttle:${scope}`, subject))));
}
