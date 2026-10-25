import {randomUUID} from 'node:crypto';
import {sql} from 'drizzle-orm';
import {submitTurn,turnEnvelope,type SubmitTurn,type TurnEnvelope} from '@bellntell/contracts';
import type {Db} from '../db/client.js';
import type {Env} from '../env.js';
import {HttpError} from '../http.js';
import {keyedHash,randomSecret,safeEqual} from '../auth/crypto.js';
import {consumeProofThrottle} from '../auth/throttle.js';
import {prepareTx,confirmTx,proposalView,type Actor,type Proposal} from '../actions/service.js';
import {one,rows,required,lockPolicy,loadSchedule,type Executor,type Appointment} from '../scheduling/service.js';
import {configOf,redact,confirmation,type Session,type Version,type ActionReceipt} from './contracts.js';
import {loadVersion} from './configuration.js';
import {initialState,drive,interpret,current,fallback,afterCommit,textInterpretation,responseId,type Gateway} from './engine.js';
import {checksum,validateConfig} from './validator.js';
import {previewGateway,commitPreview} from './preview.js';

export type Hooks={beforeCommit?:()=>Promise<void>|void;afterCommit?:()=>Promise<void>|void};
export function projection(session:Session,version:Version){const s=session.engineState;return {id:session.id,businessId:session.businessId,mode:session.mode,status:session.status,stateRevision:session.stateRevision,checksum:version.checksum,snapshotId:version.id,sourceDraftRevision:version.sourceDraftRevision,block:version.flow.blocks.find(x=>x.id===s.blockId),directive:s.directive,slots:s.slots,customAnswers:s.customAnswers,candidates:s.candidates,pending:s.pending?{id:s.pending.id,revision:s.pending.revision,stateRevision:s.pending.stateRevision,readback:s.pending.readback,expiresAt:s.pending.expiresAt,voiceEligible:s.pending.voiceEligible,simulated:s.pending.simulated}:null,proof:s.proof?{handle:s.proof.handle,appointmentId:s.proof.appointmentId,expiresAt:s.proof.expiresAt}:null,management:s.management,receipts:s.receipts,limits:{transitions:s.transitions,detours:s.detours,newRequests:s.newRequests},flow:version.flow,policy:version.policy};}
export async function lockedSession(tx:Executor,b:string,id:string){return required(await one<Session>(tx,sql`select * from voice_sessions where business_id=${b} and id=${id} for update`));}
function active(s:Session){if(s.status!=='active'||+s.maxEndAt<Date.now())throw new HttpError(410,'SESSION_EXPIRED','This conversation ended; start a new session');}
export async function message(tx:Executor,s:Session,role:'user'|'assistant'|'system',text:string,metadata:Record<string,unknown>,inputTurnId:string|null=null,itemId:string|null=null){s.sequence++;await tx.execute(sql`insert into conversation_messages (business_id,session_id,provider_item_id,input_turn_id,role,redacted_text,sequence,metadata) values (${s.businessId},${s.id},${itemId},${inputTurnId},${role},${redact(text)},${s.sequence},${JSON.stringify(metadata)}::jsonb)`);}
export async function saveSession(tx:Executor,s:Session){await tx.execute(sql`update voice_sessions set engine_state=${JSON.stringify(s.engineState)}::jsonb,state_revision=${s.stateRevision},sequence=${s.sequence},status=${s.status},closed_at=${s.closedAt},outcome=${s.engineState.receipts.at(-1)?.kind??null} where business_id=${s.businessId} and id=${s.id}`);}
async function attempt<T>(tx:Executor,work:()=>Promise<T>):Promise<T>{await tx.execute(sql`savepoint conversation_action`);try{const result=await work();await tx.execute(sql`release savepoint conversation_action`);return result;}catch(error){await tx.execute(sql`rollback to savepoint conversation_action`);await tx.execute(sql`release savepoint conversation_action`);throw error;}}
function actorFor(s:Session,revision:number):Actor{return {kind:'session',id:s.id,sessionId:s.id,stateRevision:revision,source:s.mode==='real_test'?'owner_test':'voice',appointmentId:s.engineState.proof?.appointmentId,credentialHash:s.engineState.proof?.credential,proofExpiresAt:s.engineState.proof?.expiresAt};}
export async function realGateway(tx:Executor,env:Env,s:Session):Promise<Gateway>{
 const policy=await lockPolicy(tx,s.businessId);const schedule=await loadSchedule(tx,s.businessId);
 return {schedule,now:new Date(),invalidate:async p=>{await tx.execute(sql`update action_proposals set status='rejected',revision=revision+1,payload='{}'::jsonb where business_id=${s.businessId} and id=${p.id} and voice_session_id=${s.id} and status='prepared'`);},verified:async handle=>{
  const proof=s.engineState.proof;if(!proof||proof.handle!==handle||proof.expiresAt<Date.now())throw new HttpError(403,'OWNERSHIP_UNVERIFIED','Verify this booking through the secure field');
  const appointment=required(await one<Appointment>(tx,sql`select * from appointments where business_id=${s.businessId} and id=${proof.appointmentId}`));if(!safeEqual(proof.credential,appointment.manageTokenHash))throw new HttpError(403,'OWNERSHIP_UNVERIFIED','Booking proof was revoked');return appointment;
 },prepare:async(payload,revision)=>attempt(tx,async()=>{
  const actor=actorFor(s,revision);const requestKey=checksum({payload,policyRevision:policy.revision,appointmentRevision:'appointmentRevision'in payload?payload.appointmentRevision:null} as unknown as Parameters<typeof checksum>[0]);
  let p=await one<Proposal>(tx,sql`select * from action_proposals where business_id=${s.businessId} and voice_session_id=${s.id} and kind=${payload.kind} and status='prepared' and expires_at>now() and payload=${JSON.stringify(payload)}::jsonb and (scheduling_revision is null or scheduling_revision=${policy.revision}) for update`);
  if(p){p=required(await one<Proposal>(tx,sql`update action_proposals set revision=revision+1,expected_state_revision=${revision} where business_id=${s.businessId} and id=${p.id} returning *`));}
  else p=await prepareTx(tx,env,s.businessId,actor,`${requestKey}:${randomUUID()}`,payload,policy);
  const view=await proposalView(tx,s.businessId,p);return {id:p.id,revision:p.revision,stateRevision:revision,readback:'readback'in view?view.readback??'':'',responseId:responseId(),voiceEligible:false,payload,simulated:false,expiresAt:p.expiresAt.toISOString()};
 })};
}
async function gateway(tx:Executor,env:Env,s:Session,v:Version){return s.mode==='preview'?previewGateway(tx,env,s,v):realGateway(tx,env,s);}
export async function createSession(db:Db,env:Env,b:string,userId:string,snapshotId:string,mode:Session['mode'],acknowledge=false,requestKey?:string){
 if(mode==='real_test'&&!acknowledge)throw new HttpError(400,'REAL_ACTION_ACK_REQUIRED','Acknowledge that this test changes the real schedule');
 if(mode==='public')throw new HttpError(403,'POLICY_DENIED','Public conversations are not enabled in Phase 3');
 return db.transaction(async tx=>{
  await lockPolicy(tx,b);const v=await loadVersion(tx,b,snapshotId);const capability=requestKey?keyedHash(env.AUTH_HASH_KEY,'conversation-create',`${b}:${userId}:${requestKey}`):randomSecret();const capabilityHash=keyedHash(env.AUTH_HASH_KEY,'conversation-capability',capability);
  const existing=requestKey?await one<Session>(tx,sql`select * from voice_sessions where business_id=${b} and created_by=${userId} and capability_hash=${capabilityHash}`):undefined;
  if(existing){if(existing.configVersionId!==snapshotId||existing.mode!==mode)throw new HttpError(409,'IDEMPOTENCY_CONFLICT','Session request key was used for different settings');return {session:projection(existing,v),capability};}
  const config=configOf(v);const schedule=mode==='preview'?v.testFixture!.schedule:await loadSchedule(tx,b);const issues=validateConfig(config,schedule);if(issues.length)throw new HttpError(400,'CONFIG_INVALID',issues.map(x=>x.message).join('; '));
  const id=randomUUID();const state=initialState(config);const s=required(await one<Session>(tx,sql`insert into voice_sessions (id,business_id,config_version_id,created_by,capability_hash,mode,transport,status,engine_state,max_end_at,consent_at,consent_text_version) values (${id},${b},${v.id},${userId},${capabilityHash},${mode},'simulator','active',${JSON.stringify(state)}::jsonb,now()+interval '30 minutes',now(),'owner-text-test-v1') returning *`));
  await drive(config,s.engineState,await gateway(tx,env,s,v),s.stateRevision);await message(tx,s,'assistant',s.engineState.directive,{event:'session_started',simulated:mode==='preview',snapshotChecksum:v.checksum});await saveSession(tx,s);
  return {session:projection(s,v),capability};
 });
}
async function rejectPending(tx:Executor,env:Env,s:Session,v:Version){if(s.engineState.pending){await (await gateway(tx,env,s,v)).invalidate(s.engineState.pending);s.engineState.pending=null;}}
async function commitPending(tx:Executor,env:Env,s:Session,v:Version,proposalId:string,proposalRevision:number,stateRevision:number,source:'voice'|'browser'|'simulator',inputTurnId:string|null){
 const p=s.engineState.pending;
 if(!p){const receipt=s.engineState.receipts.find(r=>r.actionReceiptId===proposalId);if(receipt)return {receipt};throw new HttpError(409,'CONFIRMATION_REQUIRED','There is no pending proposal to confirm');}
 if(p.id!==proposalId||p.revision!==proposalRevision||p.stateRevision!==stateRevision||s.stateRevision!==stateRevision)throw new HttpError(409,'STALE_PROPOSAL','The displayed action changed; review it again');
 if(source!=='browser'&&!p.voiceEligible)throw new HttpError(409,'CONFIRMATION_REQUIRED','A complete uninterrupted read-back is required');
 let result:{receipt:ActionReceipt;managementToken?:string};
 await message(tx,s,'system','',{event:'confirmation_received',proposalId:p.id,proposalRevision:p.revision,stateRevision,source,inputTurnId});
 if(s.mode==='preview')result=await commitPreview(s,p,env,v);
 else{
  const policy=await lockPolicy(tx,s.businessId);const actor=actorFor(s,stateRevision);actor.confirmationEvidence={method:source==='voice'?'finalized-voice-confirmation':source==='simulator'?'simulator-finalized-text':'explicit-browser-confirm',proposalId:p.id,proposalRevision:p.revision,stateRevision,inputTurnId,readbackResponseId:p.responseId};
  const committed=await attempt(tx,()=>confirmTx(tx,env,s.businessId,actor,p.id,p.revision,policy));result={...committed,receipt:{...committed.receipt,simulated:false,label:'Real action committed'}};
  if(p.payload.kind==='book'){const a=required(await one<Appointment>(tx,sql`select * from appointments where business_id=${s.businessId} and id=${result.receipt.recordId}`));s.engineState.proof={handle:randomUUID(),appointmentId:a.id,credential:a.manageTokenHash,expiresAt:Date.now()+600000};}
 }
 s.engineState.receipts.push(result.receipt);afterCommit(configOf(v),s.engineState);await drive(configOf(v),s.engineState,await gateway(tx,env,s,v),s.stateRevision+1);
 s.engineState.directive=result.receipt.label+'. '+s.engineState.directive;
 await message(tx,s,'system','',{event:'action_completed',receipt:result.receipt});return result;
}
export async function processTurn(db:Db,env:Env,b:string,envelope:TurnEnvelope,text:string,input?:SubmitTurn,options:{completeTextReadback?:boolean;source?:'voice';hooks?:Hooks}={}){
 const e=turnEnvelope.parse(envelope);const cleanText=redact(text);
 const result=await db.transaction(async tx=>{
  const s=await lockedSession(tx,b,e.session_id);const v=await loadVersion(tx,b,s.configVersionId);
  const inputHash=keyedHash(env.AUTH_HASH_KEY,'conversation-turn',JSON.stringify({text:cleanText,input,revision:e.expected_state_revision}));
  const duplicate=await one<{redactedResult:ReturnType<typeof projection>;redactedArgs:{inputHash:string}}>(tx,sql`select redacted_result,redacted_args from tool_executions where business_id=${b} and session_id=${s.id} and (event_id=${e.event_id} or provider_function_call_id=${e.provider_function_call_id})`);if(duplicate){if(duplicate.redactedArgs.inputHash!==inputHash)throw new HttpError(409,'IDEMPOTENCY_CONFLICT','Turn identity was used for different input');return {session:duplicate.redactedResult,replay:true};}
  active(s);if(s.stateRevision!==e.expected_state_revision||s.engineState.seenTurns.includes(e.input_turn_id))throw new HttpError(409,'STALE_TURN','This result belongs to an older input turn or state');
  const g=await gateway(tx,env,s,v);const config=configOf(v);const turn=submitTurn.parse(input??textInterpretation(cleanText,s.engineState,config));
  await message(tx,s,'user',cleanText,{event:'turn_interpreted',providerResponseId:e.provider_response_id},e.input_turn_id,`input:${e.input_turn_id}`);
  s.engineState.latestInputTurnId=e.input_turn_id;s.engineState.seenTurns.push(e.input_turn_id);let privateToken:string|undefined;
  try{
   const decision=confirmation(cleanText);
   if(cleanText!==text){await rejectPending(tx,env,s,v);s.engineState.directive='Private codes must be entered in the secure field, not in conversation text.';}
   else if(s.engineState.pending&&decision==='accept'){
    const p=s.engineState.pending;const committed=await commitPending(tx,env,s,v,p.id,p.revision,s.stateRevision,options.source??'simulator',e.input_turn_id);privateToken=committed.managementToken;
   }else if(s.engineState.pending&&decision==='reject'){
    const block=current(config,s.engineState);await rejectPending(tx,env,s,v);s.engineState.management=null;const target=block.kind==='Book'?block.outcomes.rejected:config.flow.blocks.find(x=>x.kind==='Finish')!.id;s.engineState.blockId=target;await drive(config,s.engineState,g,s.stateRevision+1);
   }else{
    if(s.engineState.pending){s.engineState.pending.voiceEligible=false;if(turn.intent==='correction'||turn.slot_changes.length||!turn.requested_operation)await rejectPending(tx,env,s,v);}
    await interpret(config,s.engineState,turn,cleanText,g,s.stateRevision+1);
   }
  }catch(error){
   if(!(error instanceof HttpError)||![403,409,410].includes(error.status))throw error;
   const block=current(config,s.engineState);await rejectPending(tx,env,s,v);
   if(['SLOT_UNAVAILABLE','STALE_PROPOSAL'].includes(error.code)&&block.kind==='Book'){s.engineState.blockId=block.outcomes.conflict;delete s.engineState.slots.starts_at;s.engineState.candidates=[];}
   else if(error.code==='OWNERSHIP_UNVERIFIED'){s.engineState.proof=null;s.engineState.management='verify';}
   else fallback(config,s.engineState);
   s.engineState.directive=`${error.code}: ${error.message} No new action was committed.`;
  }
  s.stateRevision++;
  if(s.engineState.pending){const p=s.engineState.pending;if(p.stateRevision!==s.stateRevision&&!p.simulated){const updated=required(await one<{revision:number}>(tx,sql`update action_proposals set expected_state_revision=${s.stateRevision},revision=revision+1 where business_id=${b} and id=${p.id} and voice_session_id=${s.id} and status='prepared' returning revision`));p.revision=updated.revision;}p.stateRevision=s.stateRevision;
   await message(tx,s,'assistant',s.engineState.directive,{event:'readback_started',responseId:p.responseId,generated:true,playbackCompleted:false});
   if(options.completeTextReadback!==false&&s.transport==='simulator'&&s.engineState.directive.includes(p.readback)){p.voiceEligible=true;await message(tx,s,'system','',{event:'readback_completed',proposalId:p.id,responseId:p.responseId,transport:'simulator',generated:true,playbackCompleted:true});}
  }else await message(tx,s,'assistant',s.engineState.directive,{event:'stage',generated:true,playbackCompleted:s.transport==='simulator'});
  await saveSession(tx,s);
  const view=projection(s,v);await tx.execute(sql`insert into tool_executions (business_id,session_id,event_id,provider_function_call_id,provider_response_id,input_turn_id,expected_state_revision,requested_operation,proposal_id,redacted_args,redacted_result,status) values (${b},${s.id},${e.event_id},${e.provider_function_call_id},${e.provider_response_id},${e.input_turn_id},${e.expected_state_revision},${turn.requested_operation?.type??'none'},${s.engineState.pending?.simulated?null:s.engineState.pending?.id??null},${JSON.stringify({interpretation:turn,inputHash})}::jsonb,${JSON.stringify(view)}::jsonb,'succeeded')`);
  await options.hooks?.beforeCommit?.();return {session:view,...(privateToken?{managementToken:privateToken}:{})};
 });await options.hooks?.afterCommit?.();return result;
}
export async function browserConfirm(db:Db,env:Env,b:string,id:string,proposalId:string,revision:number,stateRevision:number){return db.transaction(async tx=>{
 const s=await lockedSession(tx,b,id);active(s);const v=await loadVersion(tx,b,s.configVersionId);const result=await commitPending(tx,env,s,v,proposalId,revision,stateRevision,'browser',null);s.stateRevision++;await message(tx,s,'assistant',s.engineState.directive,{event:'action_completed',receipt:result.receipt});await saveSession(tx,s);return {session:projection(s,v),...result};
});}
export async function playbackEvent(db:Db,env:Env,b:string,id:string,response:string,event:'completed'|'interrupted',finalText:string,providerBufferCompleted:boolean){return db.transaction(async tx=>{
 const s=await lockedSession(tx,b,id);active(s);const v=await loadVersion(tx,b,s.configVersionId);const p=s.engineState.pending;
 if(!p||p.responseId!==response)throw new HttpError(409,'STALE_TURN','Read-back response is obsolete');
 p.voiceEligible=event==='completed'&&providerBufferCompleted&&finalText.includes(p.readback);s.stateRevision++;p.stateRevision=s.stateRevision;
 if(!p.simulated){await lockPolicy(tx,b);const updated=required(await one<{revision:number}>(tx,sql`update action_proposals set expected_state_revision=${s.stateRevision},revision=revision+1 where business_id=${b} and id=${p.id} and voice_session_id=${s.id} and status='prepared' returning revision`));p.revision=updated.revision;}
 await message(tx,s,'system','',{event:`readback_${event}`,responseId:response,playbackCompleted:p.voiceEligible});await saveSession(tx,s);return projection(s,v);
});}
export async function verifyAppointment(db:Db,env:Env,b:string,id:string,reference:string,token:string,ip:string){
 if(!await consumeProofThrottle(db,env.AUTH_HASH_KEY,'conversation-proof-ref',`${b}:${reference}`,5)||!await consumeProofThrottle(db,env.AUTH_HASH_KEY,'conversation-proof-ip',`${id}:${ip}`,30))throw new HttpError(429,'RATE_LIMITED','Try verification later or contact the business');
 return db.transaction(async tx=>{
  const s=await lockedSession(tx,b,id);active(s);const v=await loadVersion(tx,b,s.configVersionId);if(!v.policy.allowManagement)throw new HttpError(403,'POLICY_DENIED','Management is disabled');await lockPolicy(tx,b);
  const appointment=s.mode==='preview'?s.engineState.simulationAppointments.find(x=>x.bookingRef===reference):await one<Appointment>(tx,sql`select * from appointments where business_id=${b} and booking_ref=${reference}`);
  const hash=keyedHash(env.AUTH_HASH_KEY,'management',token);if(!appointment||!safeEqual(appointment.manageTokenHash,hash))throw new HttpError(403,'OWNERSHIP_UNVERIFIED','Verification details were not accepted');
  await rejectPending(tx,env,s,v);s.engineState.proof={handle:randomUUID(),appointmentId:appointment.id,credential:appointment.manageTokenHash,expiresAt:Date.now()+600000};s.engineState.management='choose';s.stateRevision++;s.engineState.directive='This booking is verified for ten minutes in this session. Choose reschedule or cancellation.';await saveSession(tx,s);return {session:projection(s,v)};
 });
}
export async function endSession(db:Db,env:Env,b:string,id:string){return db.transaction(async tx=>{
 const s=await lockedSession(tx,b,id);const v=await loadVersion(tx,b,s.configVersionId);if(s.status==='closed')return {session:projection(s,v)};await rejectPending(tx,env,s,v);s.status='closed';s.closedAt=s.closedAt??new Date();s.stateRevision++;s.engineState.slots={};s.engineState.customAnswers={};s.engineState.proof=null;s.engineState.management=null;s.engineState.simulationAppointments=[];s.engineState.simulationPayloads={};s.engineState.directive='Conversation ended.';
 await tx.execute(sql`update action_proposals set payload='{}'::jsonb,status='rejected' where business_id=${b} and voice_session_id=${id} and status in ('prepared','awaiting_confirmation')`);await saveSession(tx,s);return {session:projection(s,v)};
});}
export async function rejectProposal(db:Db,env:Env,b:string,id:string,proposalId:string,revision:number,stateRevision:number){return db.transaction(async tx=>{
 const s=await lockedSession(tx,b,id);active(s);const v=await loadVersion(tx,b,s.configVersionId);const p=s.engineState.pending;if(!p||p.id!==proposalId||p.revision!==revision||s.stateRevision!==stateRevision)throw new HttpError(409,'STALE_PROPOSAL','This proposal has changed');
 await rejectPending(tx,env,s,v);const block=current(configOf(v),s.engineState);s.engineState.management=null;s.engineState.blockId=block.kind==='Book'?block.outcomes.rejected:v.flow.blocks.find(x=>x.kind==='Finish')!.id;s.stateRevision++;await drive(configOf(v),s.engineState,await gateway(tx,env,s,v),s.stateRevision);await message(tx,s,'system','',{event:'proposal_rejected',proposalId});await saveSession(tx,s);return {session:projection(s,v)};
});}
export async function events(db:Db,b:string,id:string,after=0){return rows(db,sql`select sequence,role,redacted_text,metadata from conversation_messages where business_id=${b} and session_id=${id} and sequence>${after} order by sequence limit 100`);}
