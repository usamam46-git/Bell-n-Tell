import {createHash,randomUUID} from 'node:crypto';
import {conversationConfig,type ConversationConfig,type FlowBlock} from '@bellntell/contracts';
import type {Schedule} from '../scheduling/service.js';
export type ValidationIssue={path:string;message:string};
export function canonical(value:unknown):string{if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;if(value&&typeof value==='object')return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;return JSON.stringify(value);}
export function checksum(config:ConversationConfig){return createHash('sha256').update(canonical(config)).digest('hex');}
const edges:Record<string,Record<string,string[]>>={Greet:{next:['Understand']},Ask:{answered:['Ask','Contact','Inquiry','Human','Understand'],skipped:['Ask','Contact','Inquiry','Human','Understand'],failed:['Human']},Understand:{question:['Answer'],book:['Availability'],inquiry:['Ask','Contact','Inquiry'],human:['Human'],unknown:['Human'],manage:['Finish']},Answer:{answered:['Understand','Finish'],unknown:['Human','Inquiry']},Availability:{selected:['Contact','Book'],none:['Inquiry','Human'],error:['Human']},Book:{confirmed:['Finish'],conflict:['Availability'],rejected:['Understand','Finish'],error:['Human']},Contact:{collected:['Book','Inquiry','Human'],declined:['Human'],failed:['Human']},Inquiry:{recorded:['Finish'],declined:['Finish'],error:['Human']},Human:{recorded:['Finish'],declined:['Finish'],unavailable:['Finish']},Finish:{new_request:['Understand']}};
function bounded(block:FlowBlock,outcome:string){return (block.kind==='Finish'&&outcome==='new_request')||(block.kind==='Answer'&&outcome==='answered')||(block.kind==='Book'&&['conflict','rejected'].includes(outcome));}
export function validateConfig(input:unknown,schedule:Schedule):ValidationIssue[]{
 const parsed=conversationConfig.safeParse(input);if(!parsed.success)return parsed.error.issues.map(x=>({path:x.path.join('.'),message:x.message}));
 const config=parsed.data;const errors:ValidationIssue[]=[];const add=(path:string,message:string)=>errors.push({path,message});const blocks=new Map(config.flow.blocks.map(b=>[b.id,b]));
 if(blocks.size!==config.flow.blocks.length)add('flow.blocks','Block IDs must be unique');
 if(blocks.get(config.flow.entryBlockId)?.kind!=='Greet')add('flow.entryBlockId','Entry must be a Greet block');
 const active=new Set(schedule.services.filter(s=>s.active).map(s=>s.id));const approved=new Set(config.policy.approvedServiceIds);const faqIds=new Set(config.content.faqs.map(f=>f.id));
 if(faqIds.size!==config.content.faqs.length)add('content.faqs','FAQ IDs must be unique');
 for(const s of approved)if(!active.has(s))add('policy.approvedServiceIds','Select active services from this business');
 for(const block of blocks.values()){
  const path=`flow.blocks.${block.id}`;
  if(block.kind==='Understand'){
   const enabled=new Set(block.settings.enabledIntents);if(enabled.size!==block.settings.enabledIntents.length||!enabled.has('human'))add(path,'Enabled intents must be unique and include human');
   for(const intent of ['question','book','manage','inquiry','human'] as const){if(enabled.has(intent)!==!!block.outcomes[intent])add(path,`Provide an edge only for enabled intent ${intent}`);}
   if(enabled.has('book')&&!config.policy.allowBooking)add(path,'Booking intent is disabled by policy');if(enabled.has('manage')&&!config.policy.allowManagement)add(path,'Management intent is disabled by policy');
  }
  if(block.kind==='Ask'){
   if(block.settings.answerKind==='choice'&&!block.settings.choices)add(path,'Choice questions need 2–5 choices');if(block.settings.answerKind==='text'&&block.settings.choices)add(path,'Text questions cannot have choices');
   if(block.settings.required&&block.outcomes.skipped)add(path,'A required question cannot be skipped');if(!block.settings.required&&!block.outcomes.skipped)add(path,'Optional questions need a skipped edge');
   if(block.settings.slotKey!=='inquiry_summary'&&block.settings.slotKey!==`custom.question_${block.id}`)add(path,'Custom answer key must use this Ask block ID');
  }
  if(block.kind==='Availability'||block.kind==='Book')for(const s of block.settings.allowedServiceIds)if(!active.has(s)||!approved.has(s))add(path,'Allowed services must be active, same-tenant and approved');
  if(block.kind==='Answer')for(const f of block.settings.faqIds)if(!faqIds.has(f))add(path,'FAQ reference is missing from this configuration');
  if(block.kind==='Contact'&&block.settings.contactRequirement!==config.policy.contactRequirement)add(path,'Contact requirement must match the action policy');
  if(block.kind==='Finish'&&block.settings.allowNewRequest!==!!block.outcomes.new_request)add(path,'New request edge must match allowNewRequest');
  for(const [outcome,target] of Object.entries(block.outcomes)){
   const next=blocks.get(target);if(!next){add(path,`Missing target for ${outcome}`);continue;}
   const permitted=edges[block.kind]?.[outcome];if(permitted&&!permitted.includes(next.kind))add(path,`${outcome} must lead to ${permitted.join(' or ')}`);
  }
 }
 const visited=new Set<string>();const visiting=new Set<string>();
 function walk(id:string){if(visiting.has(id)){add('flow','Arbitrary graph cycles are not permitted');return;}if(visited.has(id))return;const block=blocks.get(id);if(!block)return;visited.add(id);visiting.add(id);for(const [outcome,target]of Object.entries(block.outcomes))if(!bounded(block,outcome))walk(target);visiting.delete(id);}
 walk(config.flow.entryBlockId);
 for(const block of blocks.values())if(!visited.has(block.id))add(`flow.blocks.${block.id}`,'Block is unreachable');
 if(![...visited].some(id=>blocks.get(id)?.kind==='Human'))add('flow','A reachable Human fallback is required');if(![...visited].some(id=>blocks.get(id)?.kind==='Finish'))add('flow','A reachable Finish is required');
 // Check every non-bounded path, tracking whether Contact has collected the critical fields.
 const readySeen=new Set<string>();function ready(id:string,contact:boolean){const key=`${id}:${contact}`;if(readySeen.has(key))return;readySeen.add(key);const block=blocks.get(id);if(!block)return;if((block.kind==='Book'||block.kind==='Inquiry')&&!contact)add(`flow.blocks.${id}`,'Collect contact before Book or Inquiry');for(const [outcome,target]of Object.entries(block.outcomes))if(!bounded(block,outcome))ready(target,contact||(block.kind==='Contact'&&outcome==='collected'));}
 ready(config.flow.entryBlockId,false);
 return errors;
}
export function defaultConfig(schedule:Schedule,content:ConversationConfig['content']):ConversationConfig{
 const ids=Object.fromEntries(['greet','understand','answer','availability','contactBook','book','ask','contactInquiry','inquiry','human','finish'].map(k=>[k,randomUUID()]));const services=schedule.services.filter(s=>s.active).map(s=>s.id);const fallback=[content.publicPhone,content.publicEmail].filter(Boolean).join(' · ')||'Please use the business public contact form.';
 return {policy:{allowBooking:true,allowManagement:true,approvedServiceIds:services,contactRequirement:'either',neverPromise:['availability_before_commit','other_customer_details','guaranteed_callback_time'],customGuidance:''},content,flow:{schemaVersion:1,entryBlockId:ids.greet,maxTransitions:30,blocks:[
  {id:ids.greet,label:'Greet customer',kind:'Greet',settings:{greeting:'Hello, how can I help?'},outcomes:{next:ids.understand}},
  {id:ids.understand,label:'Understand customer request',kind:'Understand',settings:{enabledIntents:['question','book','manage','inquiry','human'],clarificationCopy:'Would you like to ask a question, book, or leave a message?'},outcomes:{question:ids.answer,book:ids.availability,manage:ids.finish,inquiry:ids.ask,human:ids.human,unknown:ids.human}},
  {id:ids.answer,label:'Answer business questions',kind:'Answer',settings:{faqIds:content.faqs.map(f=>f.id),publicTopics:['contact','address','policy','hours','services'],fallbackCopy:"I don't have that information."},outcomes:{answered:ids.understand,unknown:ids.human}},
  {id:ids.availability,label:'Check availability',kind:'Availability',settings:{allowedServiceIds:services,resourceChoice:'any',maxOptions:3},outcomes:{selected:ids.contactBook,none:ids.human,error:ids.human}},
  {id:ids.contactBook,label:'Booking contact',kind:'Contact',settings:{requireName:true,contactRequirement:'either',criticalFieldReadback:true},outcomes:{collected:ids.book,declined:ids.human,failed:ids.human}},
  {id:ids.book,label:'Book appointment',kind:'Book',settings:{allowedServiceIds:services},outcomes:{confirmed:ids.finish,conflict:ids.availability,rejected:ids.understand,error:ids.human}},
  {id:ids.ask,label:'Inquiry summary',kind:'Ask',settings:{question:'What would you like the business to know?',slotKey:'inquiry_summary',answerKind:'text',required:true,maxLength:500},outcomes:{answered:ids.contactInquiry,failed:ids.human}},
  {id:ids.contactInquiry,label:'Inquiry contact',kind:'Contact',settings:{requireName:true,contactRequirement:'either',criticalFieldReadback:true},outcomes:{collected:ids.inquiry,declined:ids.human,failed:ids.human}},
  {id:ids.inquiry,label:'Record inquiry',kind:'Inquiry',settings:{summaryPrompt:'What would you like the business to know?',includeCustomAnswers:true},outcomes:{recorded:ids.finish,declined:ids.finish,error:ids.human}},
  {id:ids.human,label:'Offer human assistance',kind:'Human',settings:{callbackOffer:'I can record a callback request.',publicContactFallback:fallback},outcomes:{recorded:ids.finish,declined:ids.finish,unavailable:ids.finish}},
  {id:ids.finish,label:'Finish',kind:'Finish',settings:{closingCopy:'Thank you.',includeReceipt:true,allowNewRequest:true},outcomes:{new_request:ids.understand}}
 ]}};
}
