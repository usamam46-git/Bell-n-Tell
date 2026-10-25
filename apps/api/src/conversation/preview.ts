import {randomUUID} from 'node:crypto';
import type {Env} from '../env.js';
import type {Executor,Appointment,Schedule} from '../scheduling/service.js';
import {slot,displayTime} from '../scheduling/service.js';
import {keyedHash,randomSecret,safeEqual} from '../auth/crypto.js';
import {HttpError} from '../http.js';
import type {Gateway} from './engine.js';
import {responseId} from './engine.js';
import type {Session,Version,Pending,ActionReceipt} from './contracts.js';
function restore(s:Session){for(const a of s.engineState.simulationAppointments){a.startsAt=new Date(a.startsAt);a.endsAt=new Date(a.endsAt);}}
export async function previewGateway(_tx:Executor,_env:Env,s:Session,v:Version):Promise<Gateway>{
 restore(s);if(!v.testFixture)throw new HttpError(400,'CONFIG_INVALID','This snapshot has no simulation fixture');
 const schedule:Schedule=structuredClone(v.testFixture.schedule);schedule.busy=[...schedule.busy.map(a=>({...a,startsAt:new Date(a.startsAt),endsAt:new Date(a.endsAt)})),...s.engineState.simulationAppointments.filter(a=>a.status==='confirmed').map(a=>({id:a.id,resourceId:a.resourceId,startsAt:a.startsAt,endsAt:a.endsAt}))];
 const now=new Date(v.testFixture.now);
 async function verified(handle:string){const proof=s.engineState.proof;if(!proof||proof.handle!==handle||proof.expiresAt<Date.now())throw new HttpError(403,'OWNERSHIP_UNVERIFIED','Verify the synthetic booking in this session');const a=s.engineState.simulationAppointments.find(a=>a.id===proof.appointmentId);if(!a||!safeEqual(a.manageTokenHash,proof.credential))throw new HttpError(403,'OWNERSHIP_UNVERIFIED','Synthetic booking proof was revoked');return a;}
 return {schedule,now,verified,invalidate:async p=>{delete s.engineState.simulationPayloads[p.id];},prepare:async(payload,revision)=>{
  let readback:string;
  if(payload.kind==='book'){
   const {service,resource,end}=slot(schedule,payload.serviceId,payload.resourceId,new Date(payload.startsAt),now);
   readback=`Book ${service.name}, ${resource.displayName}, ${displayTime(new Date(payload.startsAt),end,schedule.business.timezone)}, ${service.priceText}, ${payload.contact.name}, ${payload.contact.phone??''} ${payload.contact.email??''}`;
  }else if(payload.kind==='inquiry')readback=`Submit ${payload.type} for ${payload.contact.name}, ${payload.contact.phone??''} ${payload.contact.email??''}: ${payload.summary}`;
  else{
   const proof=s.engineState.proof;const a=await verified(proof?.handle??'');if(a.id!==payload.appointmentId||a.revision!==payload.appointmentRevision||a.status!=='confirmed')throw new HttpError(409,'STALE_PROPOSAL','Synthetic appointment changed');
   if(+a.startsAt-+now<schedule.policy.cutoffMinutes*60000)throw new HttpError(409,'POLICY_DENIED','The management cutoff has passed');
   if(payload.kind==='reschedule'){const {end,resource}=slot(schedule,a.serviceId,payload.resourceId,new Date(payload.startsAt),now,a.id,a.durationMinutes);readback=`Reschedule ${a.serviceName}, ${resource.displayName}, ${displayTime(new Date(payload.startsAt),end,a.timezone)}`;}else readback=`Cancel ${a.serviceName}, ${displayTime(a.startsAt,a.endsAt,a.timezone)}, ${a.bookingRef}`;
  }
  const existing=s.engineState.pending;const reusable=existing&&existing.simulated&&existing.expiresAt>new Date().toISOString()&&JSON.stringify(existing.payload)===JSON.stringify(payload);
  const p:Pending={id:reusable?existing.id:randomUUID(),revision:reusable?existing.revision+1:1,stateRevision:revision,readback,responseId:responseId(),voiceEligible:false,payload,simulated:true,expiresAt:reusable?existing.expiresAt:new Date(Date.now()+120000).toISOString()};s.engineState.simulationPayloads[p.id]=payload;return p;
 }};
}
export async function commitPreview(s:Session,p:Pending,env:Env,v:Version):Promise<{receipt:ActionReceipt;managementToken?:string}>{
 restore(s);if(Date.parse(p.expiresAt)<Date.now())throw new HttpError(410,'PROPOSAL_EXPIRED','Synthetic proposal expired');const payload=s.engineState.simulationPayloads[p.id];if(!payload)throw new HttpError(409,'STALE_PROPOSAL','Synthetic proposal was discarded');
 const g=await previewGateway({} as Executor,env,s,v);const checked=await g.prepare(payload,p.stateRevision);void checked;
 let recordId:string=randomUUID();let revision=1;let bookingRef:string|undefined;let managementToken:string|undefined;
 if(payload.kind==='book'){
  const {service,end}=slot(g.schedule,payload.serviceId,payload.resourceId,new Date(payload.startsAt),g.now);managementToken=randomSecret();bookingRef='SIM-'+randomSecret().slice(0,12);
  const a:Appointment={id:recordId,businessId:s.businessId,revision,customerId:randomUUID(),serviceId:service.id,resourceId:payload.resourceId,startsAt:new Date(payload.startsAt),endsAt:end,timezone:g.schedule.business.timezone,serviceName:service.name,durationMinutes:service.durationMinutes,priceText:service.priceText,status:'confirmed',source:'simulation',bookingRef,manageTokenHash:keyedHash(env.AUTH_HASH_KEY,'management',managementToken)};
  s.engineState.simulationAppointments.push(a);s.engineState.proof={handle:randomUUID(),appointmentId:a.id,credential:a.manageTokenHash,expiresAt:Date.now()+600000};
 }else if(payload.kind!=='inquiry'){
  const a=s.engineState.simulationAppointments.find(a=>a.id===payload.appointmentId)!;recordId=a.id;a.revision++;revision=a.revision;bookingRef=a.bookingRef;
  if(payload.kind==='cancel')a.status='cancelled';else{a.startsAt=new Date(payload.startsAt);a.endsAt=new Date(+a.startsAt+a.durationMinutes*60000);a.resourceId=payload.resourceId;}
 }
 const receipt:ActionReceipt={actionReceiptId:p.id,committedAt:new Date().toISOString(),recordId,revision,kind:payload.kind,simulated:true,label:'Simulation — no appointment was created',...(bookingRef?{bookingRef}:{})};delete s.engineState.simulationPayloads[p.id];return {receipt,...(managementToken?{managementToken}:{})};
}
