import {describe,it,expect} from 'vitest';
import type {ConversationConfig,SubmitTurn} from '@bellntell/contracts';
import type {Schedule} from '../src/scheduling/service.js';
import {defaultConfig,validateConfig} from '../src/conversation/validator.js';
import {initialState,drive,interpret,type Gateway} from '../src/conversation/engine.js';

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function setup(){
 const schedule={business:{id:id(1),timezone:'Asia/Karachi'},policy:{noticeMinutes:60,horizonDays:60,cutoffMinutes:1440},services:[{id:id(2),businessId:id(1),active:true,name:'Consultation',durationMinutes:30,priceText:'PKR 1000'}],resources:[{id:id(3),active:true,displayName:'Consultant'}],eligible:[{serviceId:id(2),resourceId:id(3)}],hours:[],overrides:[],busy:[]} as unknown as Schedule;
 const config=defaultConfig(schedule,{faqs:[{id:id(4),question:'Do you have parking?',answer:'Parking is available.'}],publicEmail:'owner@example.test',publicPhone:null,publicAddress:null,publicDescription:''});
 const prepared:unknown[]=[];
 const gateway={schedule,now:new Date(),prepare:async(payload:unknown,revision:number)=>{prepared.push(payload);return {id:id(10+prepared.length),revision:1,stateRevision:revision,readback:'Synthetic readback',responseId:'response',voiceEligible:false,payload,simulated:true,expiresAt:new Date(Date.now()+120000).toISOString()};},invalidate:async()=>{},verified:async()=>{throw Error('no proof');}} as Gateway;
 return {schedule,config,gateway,prepared};
}
const turn=(intent:'book'|'inquiry'|'question'|'unknown',changes:Partial<Record<'inquiry_summary'|'name'|'email',string>>={},question_text:string|null=null):SubmitTurn=>({intent,slot_changes:Object.entries(changes).map(([key,value])=>({key,op:'set' as const,value,evidence:value})) as SubmitTurn['slot_changes'],requested_operation:null,question_text,uncertain_fields:[]});

describe('complete offline conversation engine',()=>{
 it('validates the default ten block kinds and rejects a bypass around contact',()=>{
  const {schedule,config}=setup();expect(new Set(config.flow.blocks.map(b=>b.kind)).size).toBe(10);expect(validateConfig(config,schedule)).toEqual([]);
  const changed=structuredClone(config) as ConversationConfig;const availability=changed.flow.blocks.find(b=>b.kind==='Availability')!;const book=changed.flow.blocks.find(b=>b.kind==='Book')!;
  availability.outcomes.selected=book.id;expect(validateConfig(changed,schedule).some(issue=>issue.message.includes('Collect contact'))).toBe(true);
 });
 it('rejects invalid outcomes for every default block kind',()=>{
  const {schedule,config}=setup();const greet=config.flow.blocks.find(b=>b.kind==='Greet')!;
  for(const source of config.flow.blocks){
   const changed=structuredClone(config) as ConversationConfig;const block=changed.flow.blocks.find(b=>b.id===source.id)!;
   const outcome=Object.keys(block.outcomes)[0];(block.outcomes as Record<string,string>)[outcome]=greet.id;
   expect(validateConfig(changed,schedule).length,`${source.kind}.${outcome}`).toBeGreaterThan(0);
  }
 });
 it('rejects disabled booking, unknown FAQ references and cross-business services',()=>{
  const {schedule,config}=setup();const disabled=structuredClone(config) as ConversationConfig;disabled.policy.allowBooking=false;expect(validateConfig(disabled,schedule).some(x=>x.message.includes('disabled by policy'))).toBe(true);
  const faq=structuredClone(config) as ConversationConfig;const answer=faq.flow.blocks.find(b=>b.kind==='Answer');if(answer?.kind==='Answer')answer.settings.faqIds=[id(999)];expect(validateConfig(faq,schedule).some(x=>x.message.includes('FAQ reference'))).toBe(true);
  const alien=structuredClone(config) as ConversationConfig;alien.policy.approvedServiceIds=[id(998)];expect(validateConfig(alien,schedule).some(x=>x.message.includes('active services from this business'))).toBe(true);
 });
 it('collects an inquiry summary and contact before a synthetic proposal',async()=>{
  const {config,gateway,prepared}=setup();const state=initialState(config);await drive(config,state,gateway,0);
  await interpret(config,state,turn('inquiry'),'inquiry',gateway,1);expect(state.blockId).toBe(config.flow.blocks.find(b=>b.kind==='Ask')!.id);
  await interpret(config,state,turn('unknown',{inquiry_summary:'Need a callback'}),'Need a callback',gateway,2);expect(state.blockId).toBe(config.flow.blocks.find(b=>b.kind==='Contact'&&b.label==='Inquiry contact')!.id);
  await interpret(config,state,turn('unknown',{name:'Customer',email:'customer@example.test'}),'Customer customer@example.test',gateway,3);
  expect(prepared).toMatchObject([{kind:'inquiry',summary:'Need a callback',contact:{name:'Customer',email:'customer@example.test'}}]);expect(state.pending?.simulated).toBe(true);
 });
 it('answers a known FAQ during an intake detour and preserves collected fields',async()=>{
  const {config,gateway}=setup();const state=initialState(config);await drive(config,state,gateway,0);
  await interpret(config,state,turn('inquiry'),'inquiry',gateway,1);const ask=state.blockId;
  await interpret(config,state,turn('question',{},'Do you have parking?'),'Do you have parking?',gateway,2);
  expect(state.directive).toBe('Parking is available.');expect(state.blockId).toBe(ask);expect(state.detours).toBe(1);
 });
 it('allows a verified management operation while the Understand block is active',async()=>{
  const {config,gateway,prepared}=setup();const state=initialState(config);await drive(config,state,gateway,0);
  state.management='choose';state.proof={handle:id(8),appointmentId:id(9),credential:'proof',expiresAt:Date.now()+60000};
  gateway.verified=async()=>({id:id(9),revision:2,resourceId:id(3)} as Awaited<ReturnType<Gateway['verified']>>);
  await interpret(config,state,{...turn('unknown'),requested_operation:{type:'prepare_cancellation',verified_appointment_handle:id(8)}},'cancel this booking',gateway,1);
  expect(state.management).toBe('readback');expect(state.pending?.readback).toBe('Synthetic readback');expect(prepared).toMatchObject([{kind:'cancel',appointmentId:id(9),appointmentRevision:2}]);
 });
});
