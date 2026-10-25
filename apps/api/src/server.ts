import { createDb } from './db/client.js';
import { readEnv } from './env.js';
import { buildApp } from './app.js';

const env = readEnv();
const { db, pool } = createDb(env.DATABASE_URL);
const app = await buildApp(db, env);
try { await app.listen({ port: env.API_PORT, host: '127.0.0.1' }); }
catch (error) { app.log.error(error); await pool.end(); process.exitCode = 1; }
async function shutdown(){await app.close();await pool.end();}
process.once('SIGTERM',()=>{void shutdown();});
process.once('SIGINT',()=>{void shutdown();});
