import {createHash} from 'node:crypto';
import {sql} from 'drizzle-orm';
import {submitTurn,slotChange,type SubmitTurn} from '@bellntell/contracts';
import {ZodError} from 'zod';
import type {Db} from '../db/client.js';
import type {Env} from '../env.js';
import type {Sideband} from './openai.js';
import {audit,one,required} from '../scheduling/service.js';
import {processTurn,playbackEvent} from '../conversation/controller.js';
import type {EngineState,Session} from '../conversation/contracts.js';
import {persistUsage} from './usage.js';
import {HttpError} from '../http.js';
import {loadVersion} from '../conversation/configuration.js';
import {current} from '../conversation/engine.js';
import {configOf} from '../conversation/contracts.js';
import {loadSchedule,localInstants,localParts,type Schedule} from '../scheduling/service.js';

function uuid(value:string){const bytes=createHash('sha256').update(value).digest();bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;const h=bytes.subarray(0,16).toString('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;}
type Event=Record<string,unknown>;
const object=(value:unknown):Event=>value&&typeof value==='object'&&!Array.isArray(value)?value as Event:{};
const string=(value:unknown)=>typeof value==='string'?value:'';
// The feasibility route exposes only interpretation, never model-authorized writes.
// The shared Zod contract remains the final validator after this provider-facing schema.
const interpretationSchema={type:'object',additionalProperties:false,properties:{intent:{type:'string',enum:['question','book','manage','inquiry','human','finish','correction','unknown']},slot_changes:{type:'array',maxItems:8,items:{type:'object',additionalProperties:false,properties:{key:{type:'string',enum:['service_id','resource_id','preferred_date','starts_at','name','phone','email','inquiry_summary']},op:{type:'string',enum:['set','clear']},value:{type:'string'},evidence:{type:'string'}},required:['key','op','evidence']}},requested_operation:{type:'null'},question_text:{type:['string','null']},uncertain_fields:{type:'array',maxItems:8,items:{type:'string',enum:['service_id','resource_id','preferred_date','starts_at','name','phone','email','inquiry_summary']}}},required:['intent','slot_changes','requested_operation','question_text','uncertain_fields']} as const;
const monthNames=['january','february','march','april','may','june','july','august','september','october','november','december'];
const escapeRegex=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function dateWitness(text:string,value:string){const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(value);if(!match)return null;const month=monthNames[Number(match[2])-1],day=Number(match[3]);if(!month||day<1||day>31)return null;return text.match(new RegExp(`\\b${month}\\s+${day}(?:st|nd|rd|th)?(?:,?\\s+${match[1]})?\\b`,'i'))?.[0]??null;}
export function supportedVoiceEvidence(turn:SubmitTurn,text:string,schedule:Schedule,config:ReturnType<typeof configOf>,state:EngineState){
 const lower=text.toLowerCase(),rejectedKeys:SubmitTurn['slot_changes'][number]['key'][]=[];
 const slot_changes=turn.slot_changes.flatMap(change=>{
  if(change.key!=='name'&&lower.includes(change.evidence.toLowerCase()))return [change];
  if(change.op!=='set'||!change.value){rejectedKeys.push(change.key);return [];}
  let evidence:string|null=null;
  if(change.key==='service_id'){const service=schedule.services.find(s=>s.id===change.value&&s.active&&config.policy.approvedServiceIds.includes(s.id));if(service){const at=lower.indexOf(service.name.toLowerCase());if(at>=0)evidence=text.slice(at,at+service.name.length);}}
  if(change.key==='resource_id'){const resource=schedule.resources.find(r=>r.id===change.value&&r.active);if(resource){const at=lower.indexOf(resource.displayName.toLowerCase());if(at>=0)evidence=text.slice(at,at+resource.displayName.length);}}
  if(change.key==='preferred_date')evidence=dateWitness(text,change.value);
  if(change.key==='starts_at'){
   const candidate=state.candidates.find(candidate=>candidate.startsAt===change.value);if(candidate){evidence=text.match(/\b(?:first|second|third)\s+(?:available\s+)?(?:time|option)\b/i)?.[0]??null;}
   if(!evidence){const instant=new Date(change.value);if(!Number.isNaN(+instant)){const local=localParts(instant,schedule.business.timezone),date=dateWitness(text,local.date);if(date){const hour=Number(local.time.slice(0,2)),minute=local.time.slice(3),twelve=hour%12||12,period=hour<12?'a':'p';evidence=text.match(new RegExp(`\\b${twelve}${minute==='00'?'(?::00)?':`:${minute}`}\\s*${period}\\.?m\\.?`,'i'))?.[0]??null;}}}
  }
  if(change.key==='email'){const [local,domain]=change.value.split('@');if(local&&domain){const pieces=domain.split('.');if(pieces.length>=2){const pattern=`\\b${escapeRegex(local)}\\s+at\\s+${pieces.map(escapeRegex).join('\\s+dot\\s+')}\\b`;evidence=text.match(new RegExp(pattern,'i'))?.[0]??null;}}}
  if(change.key==='name'&&change.value.trim().length>=2){evidence=text.match(new RegExp(`\\b${escapeRegex(change.value.trim()).replace(/ +/g,'\\s+')}\\b`,'i'))?.[0]??null;}
  if(!evidence){rejectedKeys.push(change.key);return [];}return [{...change,evidence}];
 });
 return {turn:{...turn,slot_changes} satisfies SubmitTurn,rejectedKeys};
}
export function explicitContactTurn(text:string):SubmitTurn|null{
 const name=/\bmy name is\s+([a-z][a-z '-]{1,80})(?=[.!?]|$)/i.exec(text)?.[1]?.trim();
 const spoken=/\b(?:my )?email is\s+([a-z0-9._%+-]+)\s+at\s+([a-z0-9-]+)\s+dot\s+([a-z]{2,})\b/i.exec(text);
 const literal=/\b(?:my )?email is\s+([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})\b/i.exec(text);
 if(!name||(!spoken&&!literal))return null;
 return {intent:'book',slot_changes:[{key:'name',op:'set',value:name,evidence:name},{key:'email',op:'set',value:spoken?`${spoken[1]}@${spoken[2]}.${spoken[3]}`:literal![1],evidence:spoken?.[0]??literal![1]}],requested_operation:null,question_text:null,uncertain_fields:[]};
}
export function explicitBookingTurn(text:string,schedule:Schedule,config:ReturnType<typeof configOf>):SubmitTurn|null{
 const service=schedule.services.find(item=>item.active&&config.policy.approvedServiceIds.includes(item.id)&&text.toLowerCase().includes(item.name.toLowerCase()));
 if(!service||(!/\b(?:book|appointment)\b/i.test(text)&&text.trim().toLowerCase().replace(/[.!?]+$/,'')!==service.name.toLowerCase()))return null;
 const changes:SubmitTurn['slot_changes']=[{key:'service_id',op:'set',value:service.id,evidence:text.slice(text.toLowerCase().indexOf(service.name.toLowerCase()),text.toLowerCase().indexOf(service.name.toLowerCase())+service.name.length)}];
 const resource=schedule.resources.find(item=>item.active&&schedule.eligible.some(link=>link.serviceId===service.id&&link.resourceId===item.id)&&text.toLowerCase().includes(item.displayName.toLowerCase()));
 if(resource)changes.push({key:'resource_id',op:'set',value:resource.id,evidence:text.slice(text.toLowerCase().indexOf(resource.displayName.toLowerCase()),text.toLowerCase().indexOf(resource.displayName.toLowerCase())+resource.displayName.length)});
 const dateMatch=/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?[,]?\s+(\d{4})\b/i.exec(text);
 if(dateMatch){const month=monthNames.indexOf(dateMatch[1].toLowerCase())+1,day=Number(dateMatch[2]),date=`${dateMatch[3]}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;if(new Date(`${date}T12:00:00Z`).toISOString().slice(0,10)===date){changes.push({key:'preferred_date',op:'set',value:date,evidence:dateMatch[0]});const timeMatch=/\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*([ap])\.?m\.?\b/i.exec(text);if(timeMatch){const hour=Number(timeMatch[1])%12+(timeMatch[3].toLowerCase()==='p'?12:0),time=`${String(hour).padStart(2,'0')}:${timeMatch[2]??'00'}`,instants=localInstants(date,time,schedule.business.timezone);if(instants.length===1)changes.push({key:'starts_at',op:'set',value:instants[0].toISOString(),evidence:timeMatch[0]});}}}
 return {intent:'book',slot_changes:changes,requested_operation:null,question_text:null,uncertain_fields:[]};
}
export function interpretationInstructions(text:string,session:Session,schedule:Schedule,config:ReturnType<typeof configOf>,now=new Date()){
 const state=session.engineState,block=current(config,state);
 const approved=schedule.services.filter(service=>service.active&&config.policy.approvedServiceIds.includes(service.id));
 const services=approved.map(service=>({name:service.name,id:service.id,resources:schedule.eligible.filter(e=>e.serviceId===service.id).map(e=>schedule.resources.find(r=>r.id===e.resourceId)).filter(r=>r?.active).map(r=>({name:r!.displayName,id:r!.id}))}));
 const candidates=state.candidates.map((candidate,index)=>({option:index+1,serviceId:candidate.serviceId,resourceId:candidate.resourceId,startsAt:candidate.startsAt,local:localParts(new Date(candidate.startsAt),schedule.business.timezone)}));
 const context={stage:block.kind,serverDirective:state.directive,timezone:schedule.business.timezone,today:localParts(now,schedule.business.timezone).date,services,candidates,knownBookingFields:Object.fromEntries(Object.entries(state.slots).filter(([key])=>['service_id','resource_id','preferred_date','starts_at'].includes(key)))};
 return `Interpret only this finalized customer turn as one submit_turn function call. Current trusted context: ${JSON.stringify(context)}. Customer words: ${JSON.stringify(text)}. Map a spoken service or resource name to its listed ID. Map a selected offered option to its exact listed startsAt and resourceId. A booking date must be YYYY-MM-DD in the business timezone; an appointment start must include a timezone offset. Use a substring of the customer words as evidence for each set or clear. Do not invent a service, resource, time, name, or contact detail. If a date, time, or choice is ambiguous, put that field in uncertain_fields and leave it unset. Return requested_operation null. Never confirm or execute an action.`;
}
export class VoiceController{
 private readyResolve?:()=>void;private readyReject?:(error:Error)=>void;private finalResolve?:()=>void;private finalSeen=false;private queue=Promise.resolve();private speaking=false;private activeResponseId='';private readbackResponseId='';private readbackText='';private readbackTranscript='';private readbackDone=false;private queuedInput:null|{itemId:string;text:string}=null;private inflight:null|{itemId:string;text:string;revision:number;responseId:string;stale:boolean}=null;private pendingTool:null|{responseId:string;callId:string;arguments:string}=null;private responses=0;private doneResponses=new Set<string>();private committedInputs=new Set<string>();private transcribedInputs=new Set<string>();private speechOpen=false;private missingUsage=false;private turns=0;private lastInput=Date.now();private stopped=false;private terminating=false;private expectedClose=false;
 constructor(private db:Db,private env:Env,private businessId:string,private sessionId:string,private sideband:Sideband,private terminate:(reason:string)=>Promise<void>){
  sideband.onEvent(value=>{this.queue=this.queue.then(()=>this.receive(object(value))).catch(error=>{if(this.terminating)return;this.terminating=true;return this.terminate(`sideband_event_failure_${error instanceof HttpError?error.code:error instanceof ZodError?`schema_${error.issues[0]?.path.join('_')??'unknown'}`:error instanceof Error?error.name:'unknown'}`);});});
  sideband.onClose(()=>{if(!this.stopped&&!this.terminating&&!this.expectedClose){this.terminating=true;void this.terminate('sideband_closed');}});
 }
 async configure(){
  const ready=new Promise<void>((resolve,reject)=>{this.readyResolve=resolve;this.readyReject=reject;});
  this.sideband.send({type:'session.update',session:{type:'realtime',audio:{input:{transcription:{model:'gpt-transcribe'},turn_detection:{type:'server_vad',create_response:false,interrupt_response:true}}},tools:[],tool_choice:'none',max_output_tokens:1024}});
  await Promise.race([ready,new Promise<never>((_,reject)=>setTimeout(()=>reject(Error('Provider session update timed out')),10000))]);
 }
 async start(){const s=await this.state();this.speak(s.engineState.directive);}
 expectClose(){this.expectedClose=true;}
 stop(){this.stopped=true;this.sideband.close();}
 async waitForFinalUsage(){if(this.terminating)return;if(!this.finalSeen)await Promise.race([new Promise<void>(resolve=>{this.finalResolve=resolve;}),new Promise<void>(resolve=>setTimeout(resolve,2000))]);await this.queue;}
 usageComplete(){return !this.missingUsage&&this.responses>0&&this.doneResponses.size===this.responses&&!this.speechOpen&&[...this.committedInputs].every(id=>this.transcribedInputs.has(id));}
 watchdog(now=Date.now()){if(this.stopped)return;if(now-this.lastInput>60000)void this.terminate('idle_limit');}
 private async state(){return required(await one<Session>(this.db,sql`select * from voice_sessions where business_id=${this.businessId} and id=${this.sessionId}`));}
 private speak(text:string){if(this.responses>=24){void this.terminate('response_limit');return;}this.responses++;this.speaking=true;this.sideband.send({type:'response.create',response:{output_modalities:['audio'],tools:[],tool_choice:'none',max_output_tokens:1024,metadata:{response_purpose:'speech'},instructions:`Say only the following message, in full. Do not claim an action succeeded unless the text says it was committed. Message: ${text}`}});}
 private async interpret(text:string,providerItemId:string){if(this.responses>=24||this.turns>=12){void this.terminate('turn_limit');return;}const s=await this.state();const version=await loadVersion(this.db,this.businessId,s.configVersionId);const config=configOf(version),block=current(config,s.engineState);if(block.kind==='Contact'){const contact=explicitContactTurn(text);if(contact){await this.apply(text,providerItemId,undefined,s.stateRevision,contact);return;}}const schedule=await loadSchedule(this.db,this.businessId);if(block.kind==='Understand'||block.kind==='Availability'){const booking=explicitBookingTurn(text,schedule,config);if(booking){await this.apply(text,providerItemId,undefined,s.stateRevision,booking);return;}}this.responses++;this.inflight={itemId:providerItemId,text,revision:s.stateRevision,responseId:'',stale:false};this.pendingTool=null;this.sideband.send({type:'response.create',response:{output_modalities:['text'],tool_choice:{type:'function',name:'submit_turn'},tools:[{type:'function',name:'submit_turn',description:'Report this finalized customer turn. Never claim an action is committed.',parameters:interpretationSchema}],max_output_tokens:1024,metadata:{response_purpose:'interpretation'},instructions:interpretationInstructions(text,s,schedule,config)}});}
 private async apply(text:string,providerItemId:string,tool?:{responseId:string;callId:string;arguments:string},expectedRevision?:number,directTurn?:SubmitTurn){
  const s=await this.state();let interpreted:ReturnType<typeof submitTurn.safeParse>|null=directTurn?submitTurn.safeParse(directTurn):null;
  if(tool){let argumentsValue:unknown;try{argumentsValue=JSON.parse(tool.arguments);}catch{await audit(this.db,this.businessId,'provider','realtime','voice.tool_schema_rejected','voice_session',this.sessionId,{issues:[{path:'',code:'invalid_json'}]});throw new HttpError(400,'TOOL_SCHEMA_INVALID','Provider returned invalid tool JSON');}
   const input=object(argumentsValue),changes=Array.isArray(input.slot_changes)?input.slot_changes:null;
   if(changes){const accepted:unknown[]=[],rejected:{path:string;code:string}[]=[];changes.forEach((change,index)=>{const parsed=slotChange.safeParse(change);if(parsed.success)accepted.push(parsed.data);else rejected.push(...parsed.error.issues.slice(0,2).map(issue=>({path:`slot_changes.${index}${issue.path.length?'.'+issue.path.join('.'):''}`,code:issue.code})));});if(rejected.length)await audit(this.db,this.businessId,'provider','realtime','voice.tool_field_rejected','voice_session',this.sessionId,{issues:rejected.slice(0,8)});input.slot_changes=accepted;}
   interpreted=submitTurn.safeParse(input);if(!interpreted.success){await audit(this.db,this.businessId,'provider','realtime','voice.tool_schema_rejected','voice_session',this.sessionId,{issues:interpreted.error.issues.slice(0,8).map(issue=>({path:issue.path.join('.'),code:issue.code}))});throw new HttpError(400,'TOOL_SCHEMA_INVALID','Provider returned an invalid submit_turn payload');}}
  const version=interpreted?.success?await loadVersion(this.db,this.businessId,s.configVersionId):null,schedule=version?await loadSchedule(this.db,this.businessId):null;
  const supported=interpreted?.success&&version&&schedule?supportedVoiceEvidence(interpreted.data,text,schedule,configOf(version),s.engineState):null;if(supported?.rejectedKeys.length)await audit(this.db,this.businessId,'provider','realtime','voice.slot_evidence_rejected','voice_session',this.sessionId,{keys:supported.rejectedKeys});
  let result:Awaited<ReturnType<typeof processTurn>>;try{result=await processTurn(this.db,this.env,this.businessId,{event_id:uuid(`${this.sessionId}:${providerItemId}:${tool?.callId??'confirmation'}`),session_id:this.sessionId,input_turn_id:uuid(`${this.sessionId}:${providerItemId}`),expected_state_revision:expectedRevision??s.stateRevision,provider_response_id:tool?.responseId??`voice-confirm:${providerItemId}`,provider_function_call_id:tool?.callId??`voice-confirm:${providerItemId}`},text,supported?.turn,{completeTextReadback:false,source:'voice'});}catch(error){await audit(this.db,this.businessId,'provider','realtime','voice.turn_rejected','voice_session',this.sessionId,{code:error instanceof HttpError?error.code:error instanceof ZodError?'SCHEMA_INVALID':'INTERNAL_ERROR',issues:error instanceof ZodError?error.issues.slice(0,8).map(issue=>({path:issue.path.join('.'),code:issue.code})):[]});throw error;}
  this.speak(result.session.directive);
 }
 private async receive(event:Event){
  if(this.stopped||this.terminating)return;const type=string(event.type);
  if(type==='session.updated'){const session=object(event.session);const audio=object(session.audio);const input=object(audio.input);const detection=object(input.turn_detection);if(detection.create_response===false&&detection.interrupt_response===true)this.readyResolve?.();else this.readyReject?.(Error('Provider ignored server-controlled VAD'));return;}
  if(type==='error'){this.readyReject?.(Error('Provider session setup failed'));this.terminating=true;await this.terminate('provider_error');return;}
  if(type==='input_audio_buffer.speech_started'){
   this.speechOpen=true;this.lastInput=Date.now();if(this.readbackResponseId&&!this.readbackDone){const s=await this.state();const p=s.engineState.pending;if(p)await playbackEvent(this.db,this.env,this.businessId,this.sessionId,p.responseId,'interrupted',this.readbackTranscript,false);}
   return;
  }
  if(type==='input_audio_buffer.speech_stopped'){this.speechOpen=false;return;}
  if(type==='input_audio_buffer.committed'){const id=string(event.item_id);if(id)this.committedInputs.add(id);else this.missingUsage=true;return;}
  if(type==='conversation.item.input_audio_transcription.completed'){
   const id=string(event.item_id),text=string(event.transcript).trim();if(!id){this.missingUsage=true;return;}this.lastInput=Date.now();this.turns++;
   if(event.usage)await persistUsage(this.db,this.businessId,this.sessionId,'transcription',id,event.usage,'gpt-transcribe');else this.missingUsage=true;
   this.transcribedInputs.add(id);if(!text)return;
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
   const response=object(event.response),id=string(response.id);if(!id){this.missingUsage=true;return;}this.doneResponses.add(id);if(response.usage)await persistUsage(this.db,this.businessId,this.sessionId,'response',id,response.usage,this.env.OPENAI_REALTIME_MODEL);else this.missingUsage=true;
   if(this.inflight?.responseId===id){const current=this.inflight,tool=this.pendingTool;this.inflight=null;this.pendingTool=null;if(!current.stale&&tool?.responseId===id&&response.status==='completed')await this.apply(current.text,current.itemId,tool,current.revision);else if(this.queuedInput){const next=this.queuedInput;this.queuedInput=null;await this.interpret(next.text,next.itemId);}else this.speak('I could not process that request. Please try again or use the on-screen controls.');return;}
   if(id===this.activeResponseId){this.speaking=false;if(this.queuedInput&&!this.inflight){const next=this.queuedInput;this.queuedInput=null;await this.interpret(next.text,next.itemId);}}
   return;
  }
  if(type==='output_audio_buffer.stopped'&&string(event.response_id)===this.readbackResponseId){
   const s=await this.state(),p=s.engineState.pending;const exact=this.readbackTranscript.includes(this.readbackText);if(p){await audit(this.db,this.businessId,'provider','realtime','voice.readback_match','voice_session',this.sessionId,{exact,transcriptLength:this.readbackTranscript.length,requiredLength:this.readbackText.length});if(exact)await playbackEvent(this.db,this.env,this.businessId,this.sessionId,p.responseId,'completed',this.readbackTranscript,true);}this.readbackDone=true;this.readbackResponseId='';return;
  }
  if(type==='output_audio_buffer.cleared'&&string(event.response_id)===this.readbackResponseId){const s=await this.state(),p=s.engineState.pending;if(p)await playbackEvent(this.db,this.env,this.businessId,this.sessionId,p.responseId,'interrupted',this.readbackTranscript,false);this.readbackResponseId='';this.readbackDone=false;}
  if(type==='session.closed'){this.finalSeen=true;if(this.usageComplete())await this.db.execute(sql`update voice_sessions set usage_complete=true where business_id=${this.businessId} and id=${this.sessionId}`);this.finalResolve?.();}
 }
}
