import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';
export function createDb(url: string) {
  const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 3000 });
  // pg emits errors from idle clients outside any query promise. Discard that
  // client and let the next request acquire a fresh connection.
  pool.on('error', () => { process.stderr.write('PostgreSQL idle connection dropped; the pool will reconnect on the next query.\n'); });
  return { db: drizzle(pool, { schema }), pool };
}
export type Db = ReturnType<typeof createDb>['db'];
