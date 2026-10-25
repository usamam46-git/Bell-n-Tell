import {sql} from 'drizzle-orm';
import type {Db} from '../db/client.js';
import type {Env} from '../env.js';
import {HttpError} from '../http.js';
import {one,required} from '../scheduling/service.js';
import {endSession} from '../conversation/controller.js';
import {keyedHash} from '../auth/crypto.js';
import type {Session} from '../conversation/contracts.js';
import type {RealtimeProvider} from './openai.js';
import {VoiceController} from './controller.js';

export class VoiceLifecycle{
 private controllers=new Map<string,VoiceController>();private timer?:ReturnType<typeof setInterval>;private ready=false;
 constructor(private db:Db,private env:Env,private provider:RealtimeProvider){}
 get reconciled(){return this.ready;}
 async reconcile(){
  try{
   const sessions=await this.db.execute(sql`select id,business_id,provider_realtime_call_id,status from voice_sessions where transport='realtime' and status in ('admitted','connecting','active','closing','termination_unknown')`);
   for(const row of sessions.rows as {id:string;business_id:string;provider_realtime_call_id:string|null;status:string}[]){
    if(row.provider_realtime_call_id&&this.env.OPENAI_API_KEY)await this.end(row.business_id,row.id,'startup_reconciliation').catch(()=>{});
    else if(!row.provider_realtime_call_id&&row.status==='admitted')await this.end(row.business_id,row.id,'expired_admission').catch(()=>{});
    else if(!row.provider_realtime_call_id)await this.db.execute(sql`update voice_sessions set status='termination_unknown' where id=${row.id} and status<>'termination_unknown'`);
   }
   this.ready=true;
  }catch{this.ready=false;}
  if(!this.timer){this.timer=setInterval(()=>{void (this.ready?this.watchdog():this.reconcile()).catch(()=>{});},5000);this.timer.unref();}
 }
 close(){if(this.timer)clearInterval(this.timer);for(const controller of this.controllers.values())controller.stop();this.controllers.clear();}
 async shutdown(){
  if(this.timer)clearInterval(this.timer);
  try{const rows=await this.db.execute(sql`select business_id,id from voice_sessions where transport='realtime' and status in ('admitted','connecting','active','closing')`);for(const row of rows.rows as {business_id:string;id:string}[])await this.end(row.business_id,row.id,'server_shutdown').catch(()=>{});}catch{/* the next startup reconciles any session left open */}
  this.close();
 }
 async offer(b:string,id:string,sdp:string){
  if(!this.ready)throw new HttpError(503,'TEMPORARILY_UNAVAILABLE','Live call recovery has not completed');
  if(!this.env.LIVE_AI_ENABLED||!this.env.OPENAI_API_KEY)throw new HttpError(503,'LIVE_AI_DISABLED','Live AI is disabled');
  if(!sdp.startsWith('v=0')||sdp.length>100000)throw new HttpError(400,'VALIDATION_ERROR','Invalid WebRTC offer');
  const session=await this.db.transaction(async tx=>{
   const s=required(await one<Session>(tx,sql`select * from voice_sessions where business_id=${b} and id=${id} for update`));
   if(s.transport!=='realtime'||s.mode!=='real_test'||s.status!=='admitted'||!s.admissionExpiresAt||+s.admissionExpiresAt<Date.now())throw new HttpError(409,'ADMISSION_EXPIRED','This live admission cannot create a call');
   await tx.execute(sql`update voice_sessions set status='connecting',heartbeat_at=now() where business_id=${b} and id=${id}`);return s;
  });
  let created;
  try{created=await this.provider.createCall(sdp,keyedHash(this.env.AUTH_HASH_KEY,'openai-safety',session.createdBy));}catch(error){await this.unknown(b,id);throw error;}
  try{await this.db.execute(sql`update voice_sessions set provider_realtime_call_id=${created.callId} where business_id=${b} and id=${id} and status='connecting'`);}catch(error){await this.provider.hangup(created.callId).catch(()=>{});throw error;}
  try{
   const sideband=await this.provider.attach(created.callId);
   const controller=new VoiceController(this.db,this.env,b,id,sideband,async reason=>{await this.end(b,id,reason);});this.controllers.set(id,controller);await controller.configure();
   await this.db.execute(sql`update voice_sessions set status='active',heartbeat_at=now() where business_id=${b} and id=${id} and status='connecting'`);
   await controller.start();return {answerSdp:created.answerSdp,callId:created.callId};
  }catch(error){await this.end(b,id,'setup_failure').catch(()=>{});throw error;}
 }
 async heartbeat(b:string,id:string){const s=required(await one<Session>(this.db,sql`update voice_sessions set heartbeat_at=now() where business_id=${b} and id=${id} and transport='realtime' and status='active' returning *`));return {status:s.status,maxEndAt:s.maxEndAt};}
 async end(b:string,id:string,reason:string){
  const s=required(await one<Session>(this.db,sql`select * from voice_sessions where business_id=${b} and id=${id}`));if(s.status==='closed'||s.status==='failed')return {status:s.status};
  if(s.status==='termination_unknown'&&!s.providerRealtimeCallId)throw new HttpError(503,'TERMINATION_UNKNOWN','Call setup may have created an untracked provider call; reconcile operator usage');
  await this.db.execute(sql`update voice_sessions set status='closing',outcome=${reason} where business_id=${b} and id=${id} and status<>'termination_unknown'`);
  if(s.providerRealtimeCallId){try{await this.provider.hangup(s.providerRealtimeCallId);}catch{await this.unknown(b,id);throw new HttpError(503,'TERMINATION_UNKNOWN','Provider termination could not be verified');}}
  const controller=this.controllers.get(id);if(controller)await controller.waitForFinalUsage();controller?.stop();this.controllers.delete(id);
  await endSession(this.db,this.env,b,id);
  await this.db.execute(sql`update voice_sessions set outcome=${reason} where business_id=${b} and id=${id}`);
  const final=required(await one<{usageComplete:boolean}>(this.db,sql`select usage_complete from voice_sessions where business_id=${b} and id=${id}`));
  if(!s.providerRealtimeCallId||final.usageComplete){await this.db.transaction(async tx=>{await tx.execute(sql`update usage_guard_state set unresolved_reserve_usd=greatest(0,unresolved_reserve_usd-${Number(s.reservedUsd)}),updated_at=now() where id=1`);await tx.execute(sql`update voice_sessions set reserved_usd=0,usage_complete=true where business_id=${b} and id=${id}`);});}
  return {status:'closed',usageComplete:!s.providerRealtimeCallId||final.usageComplete};
 }
 private async unknown(b:string,id:string){await this.db.execute(sql`update voice_sessions set status='termination_unknown' where business_id=${b} and id=${id}`);}
 private async watchdog(){
  for(const c of this.controllers.values())c.watchdog();
  const rows=await this.db.execute(sql`select s.business_id,s.id from voice_sessions s join businesses b on b.id=s.business_id where s.transport='realtime' and s.status in ('admitted','connecting','active') and (s.max_end_at<now() or b.status<>'active' or (s.status='active' and s.heartbeat_at<now()-interval '15 seconds') or (s.status='admitted' and s.admission_expires_at<now()))`);
  for(const row of rows.rows as {business_id:string;id:string}[])await this.end(row.business_id,row.id,'watchdog').catch(()=>{});
 }
}
