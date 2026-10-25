import {randomUUID} from 'node:crypto';
import {sql} from 'drizzle-orm';
import type {Db} from '../db/client.js';
import type {Env} from '../env.js';
import {HttpError} from '../http.js';
import {keyedHash,randomSecret} from '../auth/crypto.js';
import {loadSchedule,lockPolicy,one,required} from '../scheduling/service.js';
import {loadVersion} from '../conversation/configuration.js';
import {configOf} from '../conversation/contracts.js';
import {initialState,drive} from '../conversation/engine.js';
import {validateConfig} from '../conversation/validator.js';
import {projection} from '../conversation/controller.js';

const reserve=0.25,totalLimit=1;
export async function admitLiveOwnerTest(db:Db,env:Env,b:string,userId:string,snapshotId:string,consentVersion:string){
 if(!env.LIVE_AI_ENABLED||!env.OPENAI_API_KEY)throw new HttpError(503,'LIVE_AI_DISABLED','Live AI is disabled');
 if(consentVersion!=='owner-voice-test-v1')throw new HttpError(400,'CONSENT_REQUIRED','Review the current AI and transcription disclosure');
 return db.transaction(async tx=>{
  await tx.execute(sql`insert into usage_guard_state (id) values (1) on conflict (id) do nothing`);
  const guard=required(await one<{lifetimeObservedUsd:string;unresolvedReserveUsd:string}>(tx,sql`select lifetime_observed_usd,unresolved_reserve_usd from usage_guard_state where id=1 for update`));
  const unresolved=await one<{id:string}>(tx,sql`select id from voice_sessions where transport='realtime' and status in ('admitted','connecting','active','closing','termination_unknown') limit 1`);
  if(unresolved)throw new HttpError(409,'BUDGET_GUARD','A live or unresolved call already holds the single-call permit');
  const incomplete=await one<{id:string}>(tx,sql`select id from voice_sessions where transport='realtime' and status in ('closed','failed') and usage_complete=false limit 1`);
  if(incomplete)throw new HttpError(409,'BUDGET_GUARD','A previous live call has incomplete usage; reconcile provider spend before another call');
  const count=required(await one<{count:number}>(tx,sql`select count(*)::int as count from voice_sessions where transport='realtime' and (created_at at time zone ${env.LIVE_OPERATOR_TIMEZONE})::date=(now() at time zone ${env.LIVE_OPERATOR_TIMEZONE})::date`));
  if(count.count>=10||Number(guard.lifetimeObservedUsd)+Number(guard.unresolvedReserveUsd)+reserve>totalLimit)throw new HttpError(429,'BUDGET_GUARD','The development call or spend guard has been reached');
  await lockPolicy(tx,b);const version=await loadVersion(tx,b,snapshotId);const config=configOf(version);const schedule=await loadSchedule(tx,b);if(schedule.business.status!=='active')throw new HttpError(403,'POLICY_DENIED','This business is paused');const issues=validateConfig(config,schedule);if(issues.length)throw new HttpError(400,'CONFIG_INVALID',issues.map(x=>x.message).join('; '));
  const state=initialState(config);await drive(config,state,{schedule,now:new Date(),prepare:async()=>{throw Error('admission cannot prepare actions');},invalidate:async()=>{},verified:async()=>{throw Error('admission cannot verify bookings');}},1);
  const capability=randomSecret();const id=randomUUID();const session=required(await one<Parameters<typeof projection>[0]>(tx,sql`insert into voice_sessions (id,business_id,config_version_id,created_by,capability_hash,mode,transport,status,engine_state,max_end_at,admission_expires_at,consent_at,consent_text_version,reserved_usd) values (${id},${b},${snapshotId},${userId},${keyedHash(env.AUTH_HASH_KEY,'conversation-capability',capability)},'real_test','realtime','admitted',${JSON.stringify(state)}::jsonb,now()+interval '45 seconds',now()+interval '60 seconds',now(),${consentVersion},${reserve}) returning *`));
  await tx.execute(sql`update usage_guard_state set unresolved_reserve_usd=unresolved_reserve_usd+${reserve},updated_at=now() where id=1`);
  return {session:projection(session,version),capability};
 });
}
