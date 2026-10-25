import {createHash} from 'node:crypto';
import {sql} from 'drizzle-orm';
import {submitTurn} from '@bellntell/contracts';
import {ZodError} from 'zod';
import type {Db} from '../db/client.js';
import type {Env} from '../env.js';
import type {Sideband} from './openai.js';
import {one,required} from '../scheduling/service.js';
import {processTurn,playbackEvent} from '../conversation/controller.js';
import type {Session} from '../conversation/contracts.js';
import {persistUsage} from './usage.js';
import {HttpError} from '../http.js';

function uuid(value:string){const bytes=createHash('sha256').update(value).digest();bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;const h=bytes.subarray(0,16).toString('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;}
type Event=Record<string,unknown>;
const object=(value:unknown):Event=>value&&typeof value==='object'&&!Array.isArray(value)?value as Event:{};
const string=(value:unknown)=>typeof value==='string'?value:'';
// The feasibility route exposes only interpretation, never model-authorized writes.
// The shared Zod contract remains the final validator after this provider-facing schema.
const interpretationSchema={type:'object',additionalProperties:false,properties:{intent:{type:'string',enum:['question','book','manage','inquiry','human','finish','correction','unknown']},slot_changes:{type:'array',maxItems:8,items:{type:'object',additionalProperties:false,properties:{key:{type:'string',enum:['service_id','resource_id','preferred_date','starts_at','name','phone','email','inquiry_summary']},op:{type:'string',enum:['set','clear']},value:{type:'string'},evidence:{type:'string'}},required:['key','op','evidence']}},requested_operation:{type:'null'},question_text:{type:['string','null']},uncertain_fields:{type:'array',maxItems:8,items:{type:'string',enum:['service_id','resource_id','preferred_date','starts_at','name','phone','email','inquiry_summary']}}},required:['intent','slot_changes','requested_operation','question_text','uncertain_fields']} as const;
export class VoiceController{
 private readyResolve?:()=>void;private readyReject?:(error:Error)=>void;private finalResolve?:()=>void;private finalSeen=false;private queue=Promise.resolve();private speaking=false;private activeResponseId='';private readbackResponseId='';private readbackText='';private readbackTranscript='';private readbackDone=false;private queuedInput:null|{itemId:string;text:string}=null;private inflight:null|{itemId:string;text:string;revision:number;responseId:string;stale:boolean}=null;private pendingTool:null|{responseId:string;callId:string;arguments:string}=null;private responses=0;private responsesDone=0;private missingUsage=false;private turns=0;private lastInput=Date.now();private stopped=false;
 constructor(private db:Db,private env:Env,private businessId:string,private sessionId:string,private sideband:Sideband,private terminate:(reason:string)=>Promise<void>){
  sideband.onEvent(value=>{this.queue=this.queue.then(()=>this.receive(object(value))).catch(error=>this.terminate(`sideband_event_failure_${error instanceof HttpError?error.code:error instanceof ZodError?`schema_${error.issues[0]?.path.join('_')??'unknown'}`:error instanceof Error?error.name:'unknown'}`));});
  sideband.onClose(()=>{if(!this.stopped)void this.terminate('sideband_closed');});
 }
 async configure(){
  const ready=new Promise<void>((resolve,reject)=>{this.readyResolve=resolve;this.readyReject=reject;});
  this.sideband.send({type:'session.update',session:{type:'realtime',audio:{input:{transcription:{model:'gpt-transcribe'},turn_detection:{type:'server_vad',create_response:false,interrupt_response:true}}},tools:[],tool_choice:'none',max_output_tokens:256}});
  await Promise.race([ready,new Promise<never>((_,reject)=>setTimeout(()=>reject(Error('Provider session update timed out')),10000))]);
 }
 async start(){const s=await this.state();this.speak(s.engineState.directive);}
 stop(){this.stopped=true;this.sideband.close();}
 async waitForFinalUsage(){if(this.finalSeen)return;await Promise.race([new Promise<void>(resolve=>{this.finalResolve=resolve;}),new Promise<void>(resolve=>setTimeout(resolve,2000))]);}
 watchdog(now=Date.now()){if(this.stopped)return;if(now-this.lastInput>60000)void this.terminate('idle_limit');}
 private async state(){return required(await one<Session>(this.db,sql`select * from voice_sessions where business_id=${this.businessId} and id=${this.sessionId}`));}
 private speak(text:string){if(this.responses>=24){void this.terminate('response_limit');return;}this.responses++;this.speaking=true;this.sideband.send({type:'response.create',response:{output_modalities:['audio'],tools:[],tool_choice:'none',max_output_tokens:256,metadata:{response_purpose:'speech'},instructions:`Say only the following message. Do not claim an action succeeded unless the text says it was committed. Message: ${text}`}});}
 private async interpret(text:string,providerItemId:string){if(this.responses>=24||this.turns>=12){void this.terminate('turn_limit');return;}this.responses++;const s=await this.state();this.inflight={itemId:providerItemId,text,revision:s.stateRevision,responseId:'',stale:false};this.pendingTool=null;this.sideband.send({type:'response.create',response:{output_modalities:['text'],tool_choice:{type:'function',name:'submit_turn'},tools:[{type:'function',name:'submit_turn',description:'Report this finalized customer turn. Never claim an action is committed.',parameters:interpretationSchema}],max_output_tokens:256,metadata:{response_purpose:'interpretation'},instructions:`Return one submit_turn function call for only this finalized user text: ${text}. Use only evidence in those words. Do not confirm or execute an action.`}});}
 private async apply(text:string,providerItemId:string,tool?:{responseId:string;callId:string;arguments:string},expectedRevision?:number){
  const s=await this.state();const interpreted=tool?submitTurn.safeParse(JSON.parse(tool.arguments)):null;if(tool&&!interpreted?.success)throw Error('Provider returned an invalid submit_turn payload');
  const result=await processTurn(this.db,this.env,this.businessId,{event_id:uuid(`${this.sessionId}:${providerItemId}:${tool?.callId??'confirmation'}`),session_id:this.sessionId,input_turn_id:uuid(`${this.sessionId}:${providerItemId}`),expected_state_revision:expectedRevision??s.stateRevision,provider_response_id:tool?.responseId??`voice-confirm:${providerItemId}`,provider_function_call_id:tool?.callId??`voice-confirm:${providerItemId}`},text,interpreted?.success?interpreted.data:undefined,{completeTextReadback:false,source:'voice'});
  this.speak(result.session.directive);
 }
 private async receive(event:Event){
  if(this.stopped)return;const type=string(event.type);
  if(type==='session.updated'){const session=object(event.session);const audio=object(session.audio);const input=object(audio.input);const detection=object(input.turn_detection);if(detection.create_response===false&&detection.interrupt_response===true)this.readyResolve?.();else this.readyReject?.(Error('Provider ignored server-controlled VAD'));return;}
  if(type==='error'){this.readyReject?.(Error('Provider session setup failed'));await this.terminate('provider_error');return;}
  if(type==='input_audio_buffer.speech_started'){
   this.lastInput=Date.now();if(this.readbackResponseId&&!this.readbackDone){const s=await this.state();const p=s.engineState.pending;if(p)await playbackEvent(this.db,this.env,this.businessId,this.sessionId,p.responseId,'interrupted',this.readbackTranscript,false);}
   return;
  }
  if(type==='conversation.item.input_audio_transcription.completed'){
   const id=string(event.item_id),text=string(event.transcript).trim();if(!id||!text)return;this.lastInput=Date.now();this.turns++;
   if(event.usage)await persistUsage(this.db,this.businessId,this.sessionId,'transcription',id,event.usage,'gpt-transcribe');else this.missingUsage=true;
   const s=await this.state();if(s.engineState.pending?.voiceEligible&&['yes','yes please','confirm','please confirm','yes confirm','no','no thanks','cancel that'].includes(text.toLowerCase().replace(/[.!?]+$/,''))){await this.apply(text,id);return;}
   if(this.inflight){this.inflight.stale=true;this.queuedInput={itemId:id,text};}
   else if(this.speaking)this.queuedInput={itemId:id,text};else await this.interpret(text,id);
   return;
  }
  if(type==='conversation.item.input_audio_transcription.failed'){this.lastInput=Date.now();this.missingUsage=true;return;}
  if(type==='response.created'){const response=object(event.response),id=string(response.id);this.activeResponseId=id;if(object(response.metadata).response_purpose==='interpretation'&&this.inflight)this.inflight.responseId=id;if(object(response.metadata).response_purpose==='speech'){const s=await this.state();if(s.engineState.pending){this.readbackResponseId=id;this.readbackText=s.engineState.pending.readback;this.readbackTranscript='';this.readbackDone=false;}}return;}
  if(type==='response.output_audio_transcript.done'&&string(event.response_id)===this.readbackResponseId){this.readbackTranscript=string(event.transcript);return;}
  if(type==='response.output_item.done'){
   const item=object(event.item);if(item.type==='function_call'&&item.name==='submit_turn'&&this.inflight?.responseId===string(event.response_id)){this.pendingTool={responseId:string(event.response_id),callId:string(item.call_id),arguments:string(item.arguments)};}return;
  }
  if(type==='response.done'){
   const response=object(event.response),id=string(response.id);this.responsesDone++;if(response.usage)await persistUsage(this.db,this.businessId,this.sessionId,'response',id,response.usage,this.env.OPENAI_REALTIME_MODEL);else this.missingUsage=true;
   if(this.inflight?.responseId===id){const current=this.inflight,tool=this.pendingTool;this.inflight=null;this.pendingTool=null;if(!current.stale&&tool?.responseId===id&&response.status==='completed')await this.apply(current.text,current.itemId,tool,current.revision);else if(this.queuedInput){const next=this.queuedInput;this.queuedInput=null;await this.interpret(next.text,next.itemId);}else this.speak('I could not process that request. Please try again or use the on-screen controls.');return;}
   if(id===this.activeResponseId){this.speaking=false;if(this.queuedInput&&!this.inflight){const next=this.queuedInput;this.queuedInput=null;await this.interpret(next.text,next.itemId);}}
   return;
  }
  if(type==='output_audio_buffer.stopped'&&string(event.response_id)===this.readbackResponseId){
   const s=await this.state(),p=s.engineState.pending;if(p&&this.readbackTranscript.includes(this.readbackText))await playbackEvent(this.db,this.env,this.businessId,this.sessionId,p.responseId,'completed',this.readbackTranscript,true);this.readbackDone=true;this.readbackResponseId='';return;
  }
  if(type==='output_audio_buffer.cleared'&&string(event.response_id)===this.readbackResponseId){const s=await this.state(),p=s.engineState.pending;if(p)await playbackEvent(this.db,this.env,this.businessId,this.sessionId,p.responseId,'interrupted',this.readbackTranscript,false);this.readbackResponseId='';this.readbackDone=false;}
  if(type==='session.closed'){this.finalSeen=true;if(!this.missingUsage&&this.responsesDone===this.responses)await this.db.execute(sql`update voice_sessions set usage_complete=true where business_id=${this.businessId} and id=${this.sessionId}`);this.finalResolve?.();}
 }
}
