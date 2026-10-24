import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';
export function createDb(url: string) {
  const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 3000 });
  return { db: drizzle(pool, { schema }), pool };
}
export type Db = ReturnType<typeof createDb>['db'];
