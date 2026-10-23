import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from './client.js';
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const { db, pool } = createDb(url);
try { await migrate(db, { migrationsFolder: new URL('../../drizzle', import.meta.url).pathname }); }
finally { await pool.end(); }
