import {sql} from 'drizzle-orm';
import type {Db} from '../db/client.js';
import {HttpError} from '../http.js';
import {audit,one,required} from '../scheduling/service.js';

function dollars(value:number){if(!Number.isFinite(value)||value<0||value>1_000_000||Math.round(value*1_000_000)!==value*1_000_000)throw new HttpError(400,'VALIDATION_ERROR','USD amounts must be nonnegative with at most six decimal places');return value;}

export async function reconcileProviderSpend(db:Db,sessionId:string,displayedUsd:number,accountedUsd:number,displayQualifier:'exact'|'less_than'='exact'){
 dollars(displayedUsd);dollars(accountedUsd);
 if(accountedUsd<displayedUsd)throw new HttpError(400,'VALIDATION_ERROR','Budgeted amount cannot be below the displayed provider charge');
 return db.transaction(async tx=>{
  const session=required(await one<{id:string;businessId:string;status:string;providerRealtimeCallId:string|null;reservedUsd:string;usageComplete:boolean;transport:string}>(tx,sql`select id,business_id,status,provider_realtime_call_id,reserved_usd,usage_complete,transport from voice_sessions where id=${sessionId} for update`));
  if(session.transport!=='realtime'||session.status!=='closed'||!session.providerRealtimeCallId||session.usageComplete||Number(session.reservedUsd)<=0)throw new HttpError(409,'RECONCILIATION_NOT_ALLOWED','Only a closed provider call with unresolved usage can be reconciled');
  const guard=required(await one<{lifetimeObservedUsd:string;unresolvedReserveUsd:string}>(tx,sql`select lifetime_observed_usd,unresolved_reserve_usd from usage_guard_state where id=1 for update`));
  const observed=required(await one<{usd:string}>(tx,sql`select coalesce(sum(estimated_usd),0)::text as usd from usage_events where business_id=${session.businessId} and session_id=${session.id}`));
  const observedUsd=Number(observed.usd),reserveUsd=Number(session.reservedUsd);
  if(accountedUsd<observedUsd||Number(guard.unresolvedReserveUsd)<reserveUsd)throw new HttpError(409,'RECONCILIATION_NOT_ALLOWED','Budgeted amount or unresolved reserve conflicts with recorded usage');
  const adjustmentUsd=Number((accountedUsd-observedUsd).toFixed(6));
  await tx.execute(sql`update usage_guard_state set lifetime_observed_usd=lifetime_observed_usd+${adjustmentUsd},unresolved_reserve_usd=unresolved_reserve_usd-${reserveUsd},reconciled_at=now(),updated_at=now() where id=1`);
  await tx.execute(sql`update voice_sessions set reserved_usd=0,usage_complete=true where business_id=${session.businessId} and id=${session.id}`);
  await audit(tx,session.businessId,'operator','local-operator','voice.usage_reconciled','voice_session',session.id,{source:'user_reported_provider_costs_view',displayedUsd,displayQualifier,accountedUsd,observedUsd,adjustmentUsd,reserveReleasedUsd:reserveUsd,providerFinalEventReceived:false});
  return {sessionId:session.id,displayedUsd,displayQualifier,accountedUsd,observedUsd,adjustmentUsd,reserveReleasedUsd:reserveUsd};
 });
}
