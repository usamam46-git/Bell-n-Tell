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
// Rolling window for public credential proof. Cookie deletion and process restarts do not reset it.
export async function consumeProofThrottle(db:Db,key:string,scope:string,subject:string,limit:number) {
 const hashedSubjectKey=keyedHash(key,`throttle:${scope}`,subject);
 return db.transaction(async tx=>{
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${scope+hashedSubjectKey},0))`);
  const used=await tx.execute(sql`select coalesce(sum(count),0)::int as count from security_throttles where scope=${scope} and hashed_subject_key=${hashedSubjectKey} and window_start>now()-interval '15 minutes'`);
  if(Number(used.rows[0].count)>=limit)return false;
  await tx.execute(sql`insert into security_throttles (scope,hashed_subject_key,window_start,count) values (${scope},${hashedSubjectKey},clock_timestamp(),1)`);
  return true;
 });
}
