import {Pool} from 'pg';
import {drizzle} from 'drizzle-orm/node-postgres';
import {migrate} from 'drizzle-orm/node-postgres/migrator';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
const root=fileURLToPath(new URL('..',import.meta.url));
const name=`bellntell_test_${randomUUID().replaceAll('-','')}`;
if(!/^bellntell_test_[a-f0-9]{32}$/.test(name))throw new Error('Unexpected test database name');
const admin=new Pool({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:3000});
let pool;
try {
 await admin.query(`CREATE DATABASE "${name}"`);
 const url=new URL(process.env.DATABASE_URL);url.pathname=`/${name}`;
 pool=new Pool({connectionString:url.toString()});
 await migrate(drizzle(pool),{migrationsFolder:resolve(root,'apps/api/drizzle')});
 const tables=await pool.query("select count(*)::int as count from information_schema.tables where table_schema='public'");
 const constraint=await pool.query("select conname from pg_constraint where conname='appointments_no_overlap'");
 if(tables.rows[0].count!==22||constraint.rowCount!==1)throw new Error('Fresh schema verification failed');
 process.stdout.write('Fresh disposable database: 22 tables and appointment exclusion constraint verified.\n');
 await pool.end();pool=undefined;
 const code=await new Promise((resolvePromise,reject)=>{const child=spawn(process.execPath,[resolve(root,'node_modules/vitest/vitest.mjs'),'run',...process.argv.slice(2)],{cwd:resolve(root,'apps/api'),env:{...process.env,NODE_ENV:'test',DATABASE_URL:url.toString()},stdio:'inherit',windowsHide:true});child.on('error',reject);child.on('exit',code=>resolvePromise(code??1));});
 process.exitCode=code;
}finally {
 await pool?.end();
 await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
 await admin.end();
}
