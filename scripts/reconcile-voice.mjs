import {Pool} from 'pg';

const [sessionId,displayedText,accountedText]=process.argv.slice(2);
if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId??'')||!/^(?:lt:)?\d+(?:\.\d{1,6})?$/.test(displayedText??'')||!/^\d+(?:\.\d{1,6})?$/.test(accountedText??''))throw Error('Usage: npm run voice:reconcile -- <session-uuid> <dashboard-displayed-usd or lt:upper-bound-usd> <conservative-budget-usd>');
const {drizzle}=await import('drizzle-orm/node-postgres');
const {reconcileProviderSpend}=await import('../apps/api/dist/voice/reconciliation.js');
const pool=new Pool({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:3000});
try{const result=await reconcileProviderSpend(drizzle(pool),sessionId,Number(displayedText.replace(/^lt:/,'')),Number(accountedText),displayedText.startsWith('lt:')?'less_than':'exact');process.stdout.write(`${JSON.stringify(result)}\n`);}finally{await pool.end();}
