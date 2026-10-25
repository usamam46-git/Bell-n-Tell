import {randomUUID} from 'node:crypto';
import {contactInput,type FlowBlock,type SubmitTurn,type ConversationConfig} from '@bellntell/contracts';
import {HttpError} from '../http.js';
import type {Payload} from '../actions/service.js';
import {availability,slot,type Schedule,type Appointment} from '../scheduling/service.js';
import {redact,type EngineState,type Pending} from './contracts.js';
export type Gateway={schedule:Schedule;now:Date;prepare:(payload:Payload,revision:number)=>Promise<Pending>;invalidate:(pending:Pending)=>Promise<void>;verified:(handle:string)=>Promise<Appointment>};
export function initialState(config:ConversationConfig):EngineState{
 const entry=config.flow.blocks.find(x=>x.id===config.flow.entryBlockId)!;
 return {blockId:entry.id,slots:{},customAnswers:{},clarifications:{},transitions:0,detours:0,newRequests:0,humanVisited:false,resumeBlockId:null,management:null,proof:null,pending:null,receipts:[],directive:'',candidates:[],latestInputTurnId:null,seenTurns:[],simulationAppointments:[],simulationPayloads:{}};
}
export function current(config:ConversationConfig,state:EngineState){const block=config.flow.blocks.find(x=>x.id===state.blockId);if(!block)throw new HttpError(400,'CONFIG_INVALID','Current block is missing');return block;}
function find(config:ConversationConfig,kind:FlowBlock['kind']){const block=config.flow.blocks.find(x=>x.kind===kind);if(!block)throw new HttpError(400,'CONFIG_INVALID',`Missing ${kind} fallback`);return block;}
export function enter(config:ConversationConfig,state:EngineState,id:string){
 state.transitions++;if(state.transitions>=30){const fallback=find(config,state.humanVisited?'Finish':'Human');state.blockId=fallback.id;state.management=null;state.humanVisited=true;state.directive=fallback.kind==='Human'?fallback.settings.publicContactFallback:'The conversation limit was reached. Please contact the business.';return;}
 state.blockId=id;
}
function move(config:ConversationConfig,state:EngineState,outcome:string){const block=current(config,state);const target=(block.outcomes as Record<string,string|undefined>)[outcome];if(!target)throw new HttpError(400,'CONFIG_INVALID',`Missing ${block.kind}.${outcome} outcome`);enter(config,state,target);}
export function fallback(config:ConversationConfig,state:EngineState){
 const block=find(config,state.humanVisited?'Finish':'Human');enter(config,state,block.id);state.management=null;if(block.kind==='Human'){state.humanVisited=true;state.directive=block.settings.callbackOffer+' '+block.settings.publicContactFallback;}else {const human=find(config,'Human') as Extract<FlowBlock,{kind:'Human'}>;state.directive=human.settings.publicContactFallback+' '+(block.kind==='Finish'?block.settings.closingCopy:'');}
}
function clarify(config:ConversationConfig,state:EngineState,key:string,text:string){state.clarifications[key]=(state.clarifications[key]??0)+1;if(state.clarifications[key]>=2)fallback(config,state);else state.directive=text;}
export function contact(state:EngineState,requirement:'phone'|'email'|'either'){
 const parsed=contactInput.safeParse({name:state.slots.name??'',phone:state.slots.phone??null,email:state.slots.email??null});
 return parsed.success&&(requirement==='either'||!!parsed.data[requirement])?parsed.data:null;
}
async function clearPending(state:EngineState,gateway:Gateway){if(state.pending)await gateway.invalidate(state.pending);state.pending=null;}
function approved(config:ConversationConfig,serviceId:string){return config.policy.allowBooking&&config.policy.approvedServiceIds.includes(serviceId);}
export async function drive(config:ConversationConfig,state:EngineState,gateway:Gateway,nextRevision:number):Promise<void>{
 for(let automatic=0;automatic<12;automatic++){
  const block=current(config,state);if(state.transitions>=30){state.directive=find(config,'Human').kind==='Human'?(find(config,'Human') as Extract<FlowBlock,{kind:'Human'}>).settings.publicContactFallback:'Please contact the business.';return;}
  if(state.management){state.directive=state.management==='verify'?'Enter your booking reference and private token in the secure field.':state.pending?state.pending.readback:'Choose cancellation or a new date/time for your verified booking.';return;}
  switch(block.kind){
   case 'Greet':{const greeting=block.settings.greeting;move(config,state,'next');state.directive=greeting+' '+(current(config,state) as Extract<FlowBlock,{kind:'Understand'}>).settings.clarificationCopy;return;}
   case 'Understand':state.directive=block.settings.clarificationCopy;return;
   case 'Answer':state.directive=block.settings.fallbackCopy;return;
   case 'Ask':{const value=block.settings.slotKey==='inquiry_summary'?state.slots.inquiry_summary:state.customAnswers[block.id];if(value&&value.length<=block.settings.maxLength&&(block.settings.answerKind==='text'||block.settings.choices?.includes(value))){move(config,state,'answered');continue;}state.directive=block.settings.question;return;}
   case 'Availability':{
    if(!state.slots.service_id){state.directive='Choose a service.';return;}
    if(!approved(config,state.slots.service_id)||!block.settings.allowedServiceIds.includes(state.slots.service_id))throw new HttpError(409,'POLICY_DENIED','This service is not approved for booking');
    if(state.slots.starts_at&&state.slots.resource_id){slot(gateway.schedule,state.slots.service_id,state.slots.resource_id,new Date(state.slots.starts_at),gateway.now);move(config,state,'selected');continue;}
    if(!state.slots.preferred_date){state.directive='Choose a local booking date.';return;}
    if(block.settings.resourceChoice==='preferred'&&!state.slots.resource_id){state.directive='Choose your preferred resource.';return;}
    state.candidates=availability(gateway.schedule,{serviceId:state.slots.service_id,resourceId:state.slots.resource_id,from:state.slots.preferred_date,to:state.slots.preferred_date},gateway.now).slice(0,block.settings.maxOptions);
    if(!state.candidates.length){move(config,state,'none');continue;}state.directive='Choose one of these available times. Availability is confirmed only when the action commits.';return;
   }
   case 'Contact':if(contact(state,block.settings.contactRequirement)){move(config,state,'collected');continue;}state.directive=block.settings.retryCopy||`Enter your name and ${block.settings.contactRequirement==='either'?'phone or email':block.settings.contactRequirement}. These details will be read back before submission.`;return;
   case 'Book':{
    const details=contact(state,config.policy.contactRequirement);if(!details||!state.slots.service_id||!state.slots.resource_id||!state.slots.starts_at){fallback(config,state);return;}
    if(!approved(config,state.slots.service_id)||!block.settings.allowedServiceIds.includes(state.slots.service_id))throw new HttpError(409,'POLICY_DENIED','This service is not approved for booking');
    if(!state.pending)state.pending=await gateway.prepare({kind:'book',serviceId:state.slots.service_id,resourceId:state.slots.resource_id,startsAt:state.slots.starts_at,contact:details},nextRevision);
    state.directive=(block.settings.readbackIntro?block.settings.readbackIntro+' ':'')+state.pending.readback+' Please confirm the exact details.';return;
   }
   case 'Inquiry':case 'Human':{
    const details=contact(state,config.policy.contactRequirement);
    if(!details){state.directive=block.kind==='Human'?block.settings.callbackOffer+' Enter your name and a contact method, or decline. '+block.settings.publicContactFallback:'Enter your name and a contact method before submitting an inquiry.';return;}
    if(!state.slots.inquiry_summary){state.directive=block.kind==='Inquiry'?block.settings.summaryPrompt:'What should the business call you about?';return;}
    let summary=state.slots.inquiry_summary;
    if(block.kind==='Inquiry'&&block.settings.includeCustomAnswers){for(const [id,value]of Object.entries(state.customAnswers)){const question=config.flow.blocks.find(x=>x.id===id&&x.kind==='Ask');if(question)summary+=`\n${question.label}: ${value}`;}}
    summary=redact(summary).slice(0,2000);
    if(!state.pending)state.pending=await gateway.prepare({kind:'inquiry',contact:details,summary,type:block.kind==='Human'?'callback':'lead',consent:true,consentVersion:'contact-v1'},nextRevision);
    state.directive=(block.kind==='Inquiry'&&block.settings.submissionIntro?block.settings.submissionIntro+' ':'')+state.pending.readback+' Confirm only if you agree to the business storing these details and contacting you.';return;
   }
   case 'Finish':state.directive=block.settings.closingCopy+(block.settings.includeReceipt&&state.receipts.length?' Your saved receipt is shown below.':'')+(block.settings.allowNewRequest&&state.newRequests<1?' You may start one new request.':'');return;
  }
 }
 fallback(config,state);
}
function same(value:string|undefined,other:string|null|undefined){return (value??null)===(other??null);}
export async function interpret(config:ConversationConfig,state:EngineState,turn:SubmitTurn,text:string,gateway:Gateway,nextRevision:number){
 let original=current(config,state);
 if(original.kind==='Finish'&&!state.management){
  if(!original.settings.allowNewRequest||state.newRequests>=1||!['book','manage','inquiry'].includes(turn.intent)){state.directive=original.settings.closingCopy;return;}
  state.newRequests++;state.slots={};state.customAnswers={};state.proof=null;state.management=null;state.humanVisited=false;move(config,state,'new_request');original=current(config,state);
 }
 const changed=turn.slot_changes.filter(x=>x.key==='custom_answer'||!same(state.slots[x.key],x.op==='clear'?null:x.value));
 for(const change of turn.slot_changes)if(!text.toLowerCase().includes(change.evidence.toLowerCase()))throw new HttpError(400,'VALIDATION_ERROR','Slot evidence must come from this input turn');
 if(changed.length){await clearPending(state,gateway);state.candidates=[];const keys=new Set(changed.map(x=>x.key));if(keys.has('service_id')){delete state.slots.resource_id;delete state.slots.starts_at;}if(keys.has('resource_id')||keys.has('preferred_date'))delete state.slots.starts_at;
  for(const change of turn.slot_changes){if(change.key==='custom_answer'){if(original.kind!=='Ask'||change.blockId!==original.id)throw new HttpError(400,'VALIDATION_ERROR','Custom answers belong only to the current Ask block');if(change.op==='clear')delete state.customAnswers[change.blockId];else state.customAnswers[change.blockId]=redact(change.value!);}else if(change.op==='clear')delete state.slots[change.key];else state.slots[change.key]=redact(change.value!);}
  if(turn.intent==='correction'&&!state.management){const kind=keys.has('service_id')||keys.has('resource_id')||keys.has('preferred_date')||keys.has('starts_at')?'Availability':keys.has('name')||keys.has('phone')||keys.has('email')?'Contact':null;const target=kind?config.flow.blocks.find(x=>x.kind===kind):null;if(target)enter(config,state,target.id);}
 }
 if(turn.intent==='finish'){await clearPending(state,gateway);state.blockId=find(config,'Finish').id;state.directive='Conversation ended. No pending action was submitted.';return;}
 if(turn.intent==='human'){await clearPending(state,gateway);fallback(config,state);await drive(config,state,gateway,nextRevision);return;}
 if(turn.intent==='question'){
  const answer=find(config,'Answer');if(answer.kind!=='Answer')return;
  if(original.kind!=='Understand'&&original.kind!=='Answer'){if(state.detours>=2){await clearPending(state,gateway);fallback(config,state);return;}state.detours++;state.resumeBlockId=state.blockId;}
  const faq=config.content.faqs.find(x=>answer.settings.faqIds.includes(x.id)&&x.question.trim().toLowerCase()===turn.question_text?.trim().toLowerCase());
  if(faq){state.directive=faq.answer;if(!state.resumeBlockId){state.blockId=answer.id;move(config,state,'answered');}state.resumeBlockId=null;return;}
  const op=turn.requested_operation;
  if(op&&['get_business_details','get_business_hours','get_services'].includes(op.type)){
   const topic=op.type==='get_business_details'?op.topic:op.type==='get_services'?'services':'hours';if(!answer.settings.publicTopics.includes(topic))throw new HttpError(403,'POLICY_DENIED','This public topic is disabled');
   state.directive=op.type==='get_business_details'?op.topic==='contact'?[config.content.publicPhone,config.content.publicEmail].filter(Boolean).join(' · ')||'Use the public contact form.':op.topic==='address'?config.content.publicAddress||'Address is not listed.':`Notice ${gateway.schedule.policy.noticeMinutes} minutes; booking horizon ${gateway.schedule.policy.horizonDays} days; management cutoff ${gateway.schedule.policy.cutoffMinutes} minutes.`:op.type==='get_services'?gateway.schedule.services.filter(x=>x.active&&config.policy.approvedServiceIds.includes(x.id)&&(!op.query||x.name.toLowerCase().includes(op.query.toLowerCase()))).map(x=>`${x.name}, ${x.durationMinutes} minutes, ${x.priceText}`).join('\n')||'No approved services.':JSON.stringify({timezone:gateway.schedule.business.timezone,weekly:gateway.schedule.hours,exceptions:gateway.schedule.overrides.filter(x=>!('date' in op)||!op.date||x.localDate===op.date)});
   state.resumeBlockId=null;return;
  }
  state.resumeBlockId=null;state.blockId=answer.id;move(config,state,'unknown');await drive(config,state,gateway,nextRevision);state.directive=answer.settings.fallbackCopy+' '+state.directive;return;
 }
 const block=current(config,state);
 if(block.kind==='Understand'&&!state.management){
  if(!block.settings.enabledIntents.includes(turn.intent as 'book')||turn.intent==='unknown'){clarify(config,state,'intent',block.settings.clarificationCopy);return;}
  if(turn.intent==='manage'){if(!config.policy.allowManagement)throw new HttpError(403,'POLICY_DENIED','Appointment management is disabled');state.management=state.proof?'choose':'verify';}
  else if(turn.intent==='book'&&!config.policy.allowBooking)throw new HttpError(403,'POLICY_DENIED','Booking is disabled');
  else move(config,state,turn.intent);
 }
 if(original.kind==='Ask'&&!changed.length&&['skip','decline'].includes(text.trim().toLowerCase())){if(original.settings.required){clarify(config,state,original.id,original.settings.retryCopy||original.settings.question);}else move(config,state,'skipped');await drive(config,state,gateway,nextRevision);return;}
 if(['Contact','Human','Inquiry'].includes(block.kind)&&['no','no thanks','decline'].includes(text.trim().toLowerCase())){await clearPending(state,gateway);if(block.kind==='Contact'){move(config,state,'declined');const human=current(config,state);if(human.kind==='Human'){state.directive=human.settings.publicContactFallback;move(config,state,'unavailable');}return;}move(config,state,'declined');await drive(config,state,gateway,nextRevision);return;}
 const op=turn.requested_operation;
 if(op){
  if(op.type==='find_resources'){if(!config.policy.approvedServiceIds.includes(op.service_id))throw new HttpError(403,'POLICY_DENIED','Service is not approved');state.directive=gateway.schedule.resources.filter(r=>r.active&&gateway.schedule.eligible.some(e=>e.serviceId===op.service_id&&e.resourceId===r.id)).map(r=>r.displayName).join(', ');return;}
  if(op.type==='find_appointment'){const a=await gateway.verified(op.verified_appointment_handle);state.directive=`${a.serviceName}, ${a.startsAt.toISOString()}, ${a.status}, revision ${a.revision}`;return;}
  if(op.type==='prepare_reschedule'||op.type==='prepare_cancellation'){
   if(!state.management||!config.policy.allowManagement)throw new HttpError(403,'OWNERSHIP_UNVERIFIED','Enter appointment management and verify this booking');const appointment=await gateway.verified(op.verified_appointment_handle);
   const payload:Payload=op.type==='prepare_cancellation'?{kind:'cancel',appointmentId:appointment.id,appointmentRevision:appointment.revision}:{kind:'reschedule',appointmentId:appointment.id,appointmentRevision:appointment.revision,resourceId:op.resource_id??appointment.resourceId,startsAt:op.starts_at};
   state.pending=await gateway.prepare(payload,nextRevision);state.management='readback';state.directive=state.pending.readback+' Please confirm the exact change.';return;
  }
  if(op.type==='prepare_appointment'){
   const c=contact(state,config.policy.contactRequirement);if(current(config,state).kind!=='Book'||!c||op.service_id!==state.slots.service_id||op.resource_id!==state.slots.resource_id||op.starts_at!==state.slots.starts_at||!same(c.name,op.name)||!same(c.phone??undefined,op.phone)||!same(c.email??undefined,op.email))throw new HttpError(409,'POLICY_DENIED','Preparation must match the collected booking fields');
  }
  if(op.type==='prepare_inquiry'){
   const c=contact(state,config.policy.contactRequirement);if(!['Inquiry','Human'].includes(current(config,state).kind)||!c||!same(c.name,op.name)||!same(c.phone??undefined,op.phone)||!same(c.email??undefined,op.email)||op.summary!==state.slots.inquiry_summary)throw new HttpError(409,'POLICY_DENIED','Preparation must match the collected inquiry');
  }
  if(op.type==='check_availability'){
   if(state.management){if(!state.proof)throw new HttpError(403,'OWNERSHIP_UNVERIFIED','Verify this booking');const a=await gateway.verified(state.proof.handle);if(a.serviceId!==op.service_id)throw new HttpError(403,'OWNERSHIP_UNVERIFIED','Availability is limited to the verified service');gateway.schedule.busy=gateway.schedule.busy.filter(x=>x.id!==a.id);const s=gateway.schedule.services.find(x=>x.id===a.serviceId);if(s)s.durationMinutes=a.durationMinutes;}
   else if(current(config,state).kind!=='Availability'||!approved(config,op.service_id))throw new HttpError(403,'POLICY_DENIED','Availability is not allowed at this stage');
   const at=current(config,state);state.candidates=availability(gateway.schedule,{serviceId:op.service_id,resourceId:op.resource_id,from:op.from,to:op.to},gateway.now).slice(0,at.kind==='Availability'?at.settings.maxOptions:3);state.directive=state.candidates.length?'Choose an available time.':'No time is available; choose another date or request a callback.';return;
  }
  if(['get_services','get_business_details','get_business_hours'].includes(op.type))throw new HttpError(403,'POLICY_DENIED','Use the question route for public information');
 }
 if(original.kind==='Ask'){
  const value=original.settings.slotKey==='inquiry_summary'?state.slots.inquiry_summary:state.customAnswers[original.id];
  if(!value||value.length>original.settings.maxLength||(original.settings.answerKind==='choice'&&!original.settings.choices?.includes(value))){clarify(config,state,original.id,original.settings.retryCopy||original.settings.question);return;}
 }
 if((block.kind==='Contact'||block.kind==='Human')&&!changed.length&&!contact(state,config.policy.contactRequirement)){clarify(config,state,block.id,block.kind==='Human'?block.settings.publicContactFallback:block.settings.retryCopy||'Please enter your name and a contact method.');return;}
 await drive(config,state,gateway,nextRevision);
}
export function afterCommit(config:ConversationConfig,state:EngineState){const block=current(config,state);state.pending=null;if(state.management){state.management=null;state.blockId=find(config,'Finish').id;}else move(config,state,block.kind==='Book'?'confirmed':block.kind==='Inquiry'?'recorded':'recorded');}
export function textInterpretation(text:string,state:EngineState,config:ConversationConfig):SubmitTurn{
 const clean=text.trim().toLowerCase();const block=current(config,state);const intent:SubmitTurn['intent']=['book','manage','inquiry','human','finish'].includes(clean)?clean as SubmitTurn['intent']:'unknown';
 const slot_changes:SubmitTurn['slot_changes']=block.kind==='Ask'&&!['skip','decline'].includes(clean)?[block.settings.slotKey==='inquiry_summary'?{key:'inquiry_summary',op:'set',value:text.slice(0,block.settings.maxLength),evidence:text.slice(0,500)}:{key:'custom_answer',blockId:block.id,op:'set',value:text.slice(0,block.settings.maxLength),evidence:text.slice(0,500)}]:[];
 const faq=config.content.faqs.some(f=>f.question.toLowerCase()===clean);return {intent:faq?'question':intent,slot_changes,requested_operation:null,question_text:faq?text:null,uncertain_fields:[]};
}
export const responseId=()=>`readback-${randomUUID()}`;
