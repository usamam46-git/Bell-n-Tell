import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { proposalInput } from '@bellntell/contracts';
import type { Db } from '../db/client.js';
import type { Env } from '../env.js';
import { keyedHash, randomSecret } from '../auth/crypto.js';
import { HttpError } from '../http.js';
import { audit, lockPolicy, loadSchedule, one, required, slot, displayTime, type Executor, type Appointment, type Policy } from '../scheduling/service.js';

export type Actor = {kind:'owner'|'form'|'management'|'session';id:string;appointmentId?:string;owner?:boolean;sessionId?:string;stateRevision?:number;source?:'voice'|'owner_test';credentialHash?:string;proofExpiresAt?:number;confirmationEvidence?:Record<string,unknown>};
export type Payload = z.infer<typeof proposalInput>;
export type Receipt = {actionReceiptId:string;committedAt:string;recordId:string;revision:number;kind:string;bookingRef?:string};
export type Proposal = {id:string;businessId:string;revision:number;actorKind:string;actorId:string;kind:string;payload:Payload;payloadHash:string;schedulingRevision:number|null;appointmentId:string|null;appointmentRevision:number|null;expiresAt:Date;status:string;result:Receipt|null;committedAt:Date|null};
export async function expireProposals(db:Executor) {
 // Internal maintenance, never a customer-authorized mutation. No schedule reservation exists.
 await db.execute(sql`update action_proposals set status='expired',revision=revision+1,payload='{}'::jsonb where status in ('prepared','awaiting_confirmation') and expires_at<now()`);
}
function canonical(value:unknown):string {
 if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
 if(value&&typeof value==='object')return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
 return JSON.stringify(value);
}
function hashes(env:Env,actor:Actor,key:string,payload:unknown) {
 return {requestKey:keyedHash(env.AUTH_HASH_KEY,'action-key',`${actor.kind}:${actor.id}:${key}`),payloadHash:keyedHash(env.AUTH_HASH_KEY,'action-payload',canonical(payload))};
}
function sameActor(p:Proposal,actor:Actor) {if(p.actorKind!==actor.kind||p.actorId!==actor.id)throw new HttpError(404,'NOT_FOUND','Proposal not found');}
function checkKey(p:Proposal,hash:string) {if(p.payloadHash!==hash)throw new HttpError(409,'IDEMPOTENCY_CONFLICT','Request key was used for different details');}
function usable(p:Proposal) {if(p.status==='expired'||(+p.expiresAt<Date.now()&&p.status!=='committed'))throw new HttpError(410,'PROPOSAL_EXPIRED','Proposal expired; review a new proposal');if(p.status==='rejected')throw new HttpError(409,'STALE_PROPOSAL','Proposal was rejected');}
function cutoff(appointment:Appointment,policy:Policy,actor:Actor,payload:Payload) {
 if(appointment.status!=='confirmed')throw new HttpError(409,'STALE_PROPOSAL','Appointment is no longer confirmed');
 if(+appointment.startsAt-Date.now()<policy.cutoffMinutes*60000) {
  if(!(actor.kind==='owner'&&actor.owner&&'overrideReason' in payload&&payload.overrideReason))throw new HttpError(409,'POLICY_DENIED','The management cutoff has passed. Contact the business for help.');
 }
}
export async function prepareTx(tx:Executor,env:Env,b:string,actor:Actor,key:string,input:Payload,policy:Policy) {
 const hash=hashes(env,actor,key,input);
 const existing=await one<Proposal>(tx,sql`select * from action_proposals where business_id=${b} and request_key=${hash.requestKey}`);
 if(existing){sameActor(existing,actor);checkKey(existing,hash.payloadHash);usable(existing);return existing;}
 let appointment:Appointment|undefined;
 if(input.kind==='reschedule'||input.kind==='cancel') {
  if(['management','session'].includes(actor.kind)&&actor.appointmentId!==input.appointmentId)throw new HttpError(403,'OWNERSHIP_UNVERIFIED','Appointment verification required');
  appointment=required(await one<Appointment>(tx,sql`select * from appointments where business_id=${b} and id=${input.appointmentId}`));
  if(appointment.revision!==input.appointmentRevision)throw new HttpError(409,'STALE_PROPOSAL','Appointment changed; reload before reviewing');
  cutoff(appointment,policy,actor,input);
 }
 if(input.kind==='book'||input.kind==='reschedule') {
  const schedule=await loadSchedule(tx,b);
  slot(schedule,input.kind==='book'?input.serviceId:appointment!.serviceId,input.resourceId,new Date(input.startsAt),new Date(),appointment?.id,appointment?.durationMinutes);
 }
 return required(await one<Proposal>(tx,sql`insert into action_proposals (business_id,actor_kind,actor_id,kind,payload,payload_hash,request_key,scheduling_revision,appointment_id,appointment_revision,voice_session_id,expected_state_revision,expires_at) values (${b},${actor.kind},${actor.id},${input.kind},${JSON.stringify(input)}::jsonb,${hash.payloadHash},${hash.requestKey},${input.kind==='inquiry'?null:policy.revision},${appointment?.id??null},${appointment?.revision??null},${actor.sessionId??null},${actor.stateRevision??null},now()+interval '120 seconds') returning *`));
}
export async function prepare(db:Db,env:Env,b:string,actor:Actor,key:string,input:Payload) {
 return db.transaction(async tx=>prepareTx(tx,env,b,actor,key,input,await lockPolicy(tx,b)));
}
export async function proposalView(db:Executor,b:string,p:Proposal) {
 if(p.status==='committed')return {id:p.id,revision:p.revision,status:p.status,receipt:p.result};
 if(p.status==='rejected'||p.status==='expired')return {id:p.id,revision:p.revision,status:p.status};
 const input=p.payload;let readback:string;
 if(input.kind==='inquiry')readback=`Submit ${input.type} for ${input.contact.name}, ${input.contact.phone??''} ${input.contact.email??''}: ${input.summary}`;
 else if(input.kind==='book'||input.kind==='reschedule') {
  const schedule=await loadSchedule(db,b);const appointment=input.kind==='reschedule'?required(await one<Appointment>(db,sql`select * from appointments where business_id=${b} and id=${input.appointmentId}`)):undefined;
  const service=required(schedule.services.find(x=>x.id===(input.kind==='book'?input.serviceId:appointment!.serviceId)));
  const resource=required(schedule.resources.find(x=>x.id===input.resourceId));const start=new Date(input.startsAt);const end=new Date(+start+(appointment?.durationMinutes??service.durationMinutes)*60000);
  const contact=input.kind==='book'?input.contact:required(await one<{name:string;phone:string|null;email:string|null}>(db,sql`select name,phone_e164 as phone,email from customers where business_id=${b} and id=${appointment!.customerId}`));
  readback=`${input.kind==='book'?'Book':'Reschedule'} ${appointment?.serviceName??service.name}, ${resource.displayName}, ${displayTime(start,end,schedule.business.timezone)}, ${appointment?.priceText??service.priceText}, ${contact.name}, ${contact.phone??''} ${contact.email??''}`;
 }else {
  const appointment=required(await one<Appointment>(db,sql`select * from appointments where business_id=${b} and id=${input.appointmentId}`));
  const customer=required(await one<{name:string;phoneE164:string|null;email:string|null}>(db,sql`select name,phone_e164,email from customers where business_id=${b} and id=${appointment.customerId}`));
  const resource=required(await one<{displayName:string}>(db,sql`select display_name from resources where business_id=${b} and id=${appointment.resourceId}`));
  readback=`Cancel ${appointment.serviceName}, ${resource.displayName}, ${displayTime(appointment.startsAt,appointment.endsAt,appointment.timezone)}, ${customer.name}, ${customer.phoneE164??''} ${customer.email??''}, reference ${appointment.bookingRef}, revision ${input.appointmentRevision}`;
 }
 return {id:p.id,revision:p.revision,status:p.status,expiresAt:p.expiresAt,payload:input,readback};
}
type Hooks={beforeCommit?:()=>void|Promise<void>;afterCommit?:()=>void|Promise<void>};
export async function confirmTx(tx:Executor,env:Env,b:string,actor:Actor,id:string,revision:number,policy:Policy) {
 const p=required(await one<Proposal>(tx,sql`select * from action_proposals where business_id=${b} and id=${id} for update`));sameActor(p,actor);
 if(p.status==='committed') {
  if(p.committedAt&&Date.now()-+p.committedAt>90*86400000)throw new HttpError(410,'RECEIPT_EXPIRED','Receipt retention has elapsed; request cannot be reused');
  return {receipt:required(p.result??undefined)};
 }
 usable(p);
 if(actor.kind==='session'){
  if(!actor.confirmationEvidence||actor.sessionId!==actor.id)throw new HttpError(409,'CONFIRMATION_REQUIRED','Controller confirmation is required');
  const bound=await one<{expectedStateRevision:number;voiceSessionId:string}>(tx,sql`select expected_state_revision,voice_session_id from action_proposals where business_id=${b} and id=${id}`);
  if(bound?.voiceSessionId!==actor.sessionId||bound.expectedStateRevision!==actor.stateRevision)throw new HttpError(409,'STALE_PROPOSAL','Conversation changed; review a new proposal');
 }
 if(p.revision!==revision)throw new HttpError(409,'STALE_PROPOSAL','Proposal changed; review it again');
 if(p.schedulingRevision!==null&&p.schedulingRevision!==policy.revision)throw new HttpError(409,'STALE_PROPOSAL','Scheduling settings changed; review a new proposal');
 const input=p.payload;let recordId:string;let recordRevision=1;let managementToken:string|undefined;let bookingRef:string|undefined;
 if(input.kind==='book'||input.kind==='inquiry') {
  const customer=required(await one<{id:string}>(tx,sql`insert into customers (business_id,name,phone_e164,email) values (${b},${input.contact.name},${input.contact.phone},${input.contact.email}) returning id`));
  if(input.kind==='inquiry') {
   recordId=required(await one<{id:string}>(tx,sql`insert into inquiries (business_id,customer_id,type,summary,source,consent_version,voice_session_id) values (${b},${customer.id},${input.type},${input.summary},${actor.kind==='form'?'form':actor.kind==='session'?'voice':'owner'},${input.consentVersion},${actor.sessionId??null}) returning id`)).id;
  } else {
   const schedule=await loadSchedule(tx,b);const {service,end}=slot(schedule,input.serviceId,input.resourceId,new Date(input.startsAt));
   managementToken=randomSecret();bookingRef=randomSecret().slice(0,16);
   recordId=required(await one<{id:string}>(tx,sql`insert into appointments (business_id,customer_id,service_id,resource_id,starts_at,ends_at,timezone,service_name,duration_minutes,price_text,source,booking_ref,manage_token_hash) values (${b},${customer.id},${input.serviceId},${input.resourceId},${new Date(input.startsAt)},${end},${schedule.business.timezone},${service.name},${service.durationMinutes},${service.priceText},${actor.source??'owner'},${bookingRef},${keyedHash(env.AUTH_HASH_KEY,'management',managementToken)}) returning id`)).id;
  }
 } else {
  const appointment=required(await one<Appointment>(tx,sql`select * from appointments where business_id=${b} and id=${input.appointmentId} for update`));
  if(appointment.revision!==p.appointmentRevision)throw new HttpError(409,'STALE_PROPOSAL','Appointment changed; review a new proposal');
  if(['management','session'].includes(actor.kind)&&actor.appointmentId!==appointment.id)throw new HttpError(403,'OWNERSHIP_UNVERIFIED','Appointment verification required');
  if(actor.kind==='session'&&(actor.credentialHash!==appointment.manageTokenHash||!actor.proofExpiresAt||actor.proofExpiresAt<Date.now()))throw new HttpError(403,'OWNERSHIP_UNVERIFIED','Booking proof expired or was revoked');
  cutoff(appointment,policy,actor,input);
  if(input.kind==='reschedule') {
   const schedule=await loadSchedule(tx,b);const {end}=slot(schedule,appointment.serviceId,input.resourceId,new Date(input.startsAt),new Date(),appointment.id,appointment.durationMinutes);
   await tx.execute(sql`update appointments set starts_at=${new Date(input.startsAt)},ends_at=${end},resource_id=${input.resourceId},revision=revision+1,updated_at=now() where business_id=${b} and id=${appointment.id}`);
  }else await tx.execute(sql`update appointments set status='cancelled',revision=revision+1,updated_at=now() where business_id=${b} and id=${appointment.id}`);
  recordId=appointment.id;recordRevision=appointment.revision+1;bookingRef=appointment.bookingRef;
 }
 const receipt:Receipt={actionReceiptId:p.id,committedAt:new Date().toISOString(),recordId,revision:recordRevision,kind:input.kind,...(bookingRef?{bookingRef}:{})};
 await tx.execute(sql`update action_proposals set status='committed',result=${JSON.stringify(receipt)}::jsonb,confirmation=${JSON.stringify({actorKind:actor.kind,actorId:actor.id,proposalRevision:revision,method:actor.kind==='form'?'explicit-form-submit':'explicit-browser-confirm',...actor.confirmationEvidence,at:receipt.committedAt})}::jsonb,committed_at=now() where business_id=${b} and id=${p.id}`);
 await audit(tx,b,actor.kind,actor.id,input.kind,input.kind==='inquiry'?'inquiry':'appointment',recordId,{'proposalId':p.id,...('overrideReason' in input&&input.overrideReason?{overrideReason:input.overrideReason}:{})});
 return {receipt,...(managementToken?{managementToken}:{})};
}
export async function confirm(db:Db,env:Env,b:string,actor:Actor,id:string,revision:number,hooks:Hooks={}) {
 const result=await db.transaction(async tx=> {const policy=await lockPolicy(tx,b);const result=await confirmTx(tx,env,b,actor,id,revision,policy);await hooks.beforeCommit?.();return result;});
 await hooks.afterCommit?.();return result;
}
export async function submitInquiry(db:Db,env:Env,b:string,actor:Actor,key:string,input:Payload) {
 return db.transaction(async tx=>{const policy=await lockPolicy(tx,b);const p=await prepareTx(tx,env,b,actor,key,input,policy);return confirmTx(tx,env,b,actor,p.id,p.revision,policy);});
}
// Consequential setup/status writes use the same durable request-key tombstones.
export async function writeOnce<T>(db:Db,env:Env,b:string,actor:Actor,key:string,operation:string,input:unknown,write:(tx:Executor,policy:Policy)=>Promise<{result:T;secret?:string}>) {
 return db.transaction(async tx=> {
  const policy=await lockPolicy(tx,b);const hash=hashes(env,actor,key,{operation,input});
  const existing=await one<Proposal>(tx,sql`select * from action_proposals where business_id=${b} and request_key=${hash.requestKey} for update`);
  if(existing){sameActor(existing,actor);checkKey(existing,hash.payloadHash);return {result:existing.result as T};}
  const result=await write(tx,policy);
  await tx.execute(sql`insert into action_proposals (business_id,actor_kind,actor_id,kind,payload,payload_hash,request_key,expires_at,status,result,confirmation,committed_at) values (${b},${actor.kind},${actor.id},${operation},'{}'::jsonb,${hash.payloadHash},${hash.requestKey},now(),'committed',${JSON.stringify(result.result)}::jsonb,'{"method":"explicit-owner-form"}'::jsonb,now())`);
  await audit(tx,b,actor.kind,actor.id,operation,'business',b);
  return result;
 });
}
