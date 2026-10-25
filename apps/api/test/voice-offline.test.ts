import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest';
import {sql} from 'drizzle-orm';
import {conversationFixture} from './conversation-fixture.js';
import {admitLiveOwnerTest} from '../src/voice/admission.js';
import {VoiceLifecycle} from '../src/voice/lifecycle.js';
import {callIdFromLocation,OpenAIRealtimeProvider,type RealtimeProvider,type Sideband} from '../src/voice/openai.js';
import {responseCost,transcriptionCost,persistUsage} from '../src/voice/usage.js';
import {one,addDays,localParts} from '../src/scheduling/service.js';
let f:Awaited<ReturnType<typeof conversationFixture>>;
beforeAll(async()=>{f=await conversationFixture();});afterAll(async()=>{await f?.cleanup();});

describe('offline voice provider and accounting',()=>{
 it('parses the unified call ID, never leaks provider error text, and uses server credentials',async()=>{
  expect(callIdFromLocation('/v1/realtime/calls/rtc_test123')).toBe('rtc_test123');expect(()=>callIdFromLocation('/other/rtc_test123')).toThrow();
  const env={...f.env,LIVE_AI_ENABLED:true,OPENAI_API_KEY:'sk-offline-fixture-credential'};
  let request:RequestInit|undefined;const client=new OpenAIRealtimeProvider(env,async(_url,init)=>{request=init;return new Response('v=0\r\nanswer',{status:201,headers:{location:'/v1/realtime/calls/rtc_test123'}});});
  expect(await client.createCall('v=0\r\noffer','opaque-safety-id')).toEqual({callId:'rtc_test123',answerSdp:'v=0\r\nanswer'});
  expect((request?.headers as Record<string,string>).Authorization).toContain('sk-offline-fixture');expect((request?.body as FormData).get('sdp')).toBe('v=0\r\noffer');
  const broken=new OpenAIRealtimeProvider(env,async()=>new Response('private provider payload',{status:401}));await expect(broken.createCall('v=0\r\noffer','opaque')).rejects.toMatchObject({code:'PROVIDER_UNAVAILABLE',message:'Provider rejected call setup (401)'});
  const timeout=new OpenAIRealtimeProvider(env,async()=>{throw Error('secret transport detail');});await expect(timeout.createCall('v=0\r\noffer','opaque')).rejects.toMatchObject({code:'PROVIDER_SETUP_UNKNOWN',message:'Provider setup did not return a confirmed result'});
 });
 it('counts cached tokens once and rejects missing modality usage',()=>{
  expect(responseCost({input_tokens:30,output_tokens:10,input_token_details:{text_tokens:20,audio_tokens:10,cached_tokens:7,cached_tokens_details:{text_tokens:5,audio_tokens:2}},output_token_details:{text_tokens:4,audio_tokens:6}})).toBeCloseTo(((15*.6+5*.06+4*2.4)+(8*10+2*.3+6*20))/1_000_000,10);
  expect(()=>responseCost({input_tokens:1,output_tokens:0})).toThrow();expect(transcriptionCost({type:'duration',seconds:60})).toBe(0.0045);expect(()=>transcriptionCost({type:'tokens',input_tokens:5})).toThrow();
 });
 it('keeps live admission disabled without a key and conservatively retains unknown usage after a fake call',async()=>{
  await expect(admitLiveOwnerTest(f.db,{...f.env,LIVE_AI_ENABLED:false,OPENAI_API_KEY:undefined},f.business.id,f.user.id,f.selected.snapshot.id,'owner-voice-test-v1')).rejects.toMatchObject({code:'LIVE_AI_DISABLED'});
  const env={...f.env,LIVE_AI_ENABLED:true,OPENAI_API_KEY:'sk-offline-fixture-credential'};
  await f.db.execute(sql`update businesses set status='paused' where id=${f.business.id}`);
  await expect(admitLiveOwnerTest(f.db,env,f.business.id,f.user.id,f.selected.snapshot.id,'owner-voice-test-v1')).rejects.toMatchObject({code:'POLICY_DENIED'});
  await f.db.execute(sql`update businesses set status='setup' where id=${f.business.id}`);
  let onEvent=(value:unknown)=>{void value;},onClose=()=>{};const emitted:unknown[]=[];let creates=0,hangups=0,failHangup=false;
  const sideband:Sideband={send:event=>{emitted.push(event);if((event as {type:string}).type==='session.update')queueMicrotask(()=>onEvent({type:'session.updated',session:{audio:{input:{turn_detection:{create_response:false,interrupt_response:true}}}}}));},close:()=>onClose(),onEvent:handler=>{onEvent=handler;},onClose:handler=>{onClose=handler;}};
  const provider:RealtimeProvider={createCall:async()=>{creates++;return {callId:'rtc_offline',answerSdp:'v=0\r\nanswer'};},attach:async()=>sideband,hangup:async()=>{hangups++;if(failHangup)throw Error('offline hangup failure');onEvent({type:'session.closed'});}};
  const lifecycle=new VoiceLifecycle(f.db,env,provider);await lifecycle.reconcile();
  const admitted=await admitLiveOwnerTest(f.db,env,f.business.id,f.user.id,f.selected.snapshot.id,'owner-voice-test-v1');
  await expect(admitLiveOwnerTest(f.db,env,f.business.id,f.user.id,f.selected.snapshot.id,'owner-voice-test-v1')).rejects.toMatchObject({code:'BUDGET_GUARD'});
  await expect(lifecycle.offer(f.business.id,admitted.session.id,'bad')).rejects.toMatchObject({code:'VALIDATION_ERROR'});expect(creates).toBe(0);
  const answer=await lifecycle.offer(f.business.id,admitted.session.id,'v=0\r\na sufficiently long local offer');expect(answer.callId).toBe('rtc_offline');expect(creates).toBe(1);expect(emitted.some(e=>(e as {type:string}).type==='response.create')).toBe(true);
  await expect(lifecycle.offer(f.business.id,admitted.session.id,'v=0\r\na sufficiently long local offer')).rejects.toMatchObject({code:'ADMISSION_EXPIRED'});expect(creates).toBe(1);
  const zero={input_tokens:0,output_tokens:0,input_token_details:{text_tokens:0,audio_tokens:0,cached_tokens_details:{text_tokens:0,audio_tokens:0}},output_token_details:{text_tokens:0,audio_tokens:0}};
  onEvent({type:'response.created',response:{id:'resp_greeting',metadata:{response_purpose:'speech'}}});onEvent({type:'response.done',response:{id:'resp_greeting',status:'completed',usage:zero}});
  const date=addDays(localParts(new Date(),'Asia/Karachi').date,5),startsAt=`${date}T11:00:00+05:00`,changedAt=`${date}T12:00:00+05:00`;
  const spoken=`book ${f.service.id} ${f.resource.id} ${date} ${startsAt} Voice Customer voice@example.test`;
  onEvent({type:'conversation.item.input_audio_transcription.completed',item_id:'item_booking',transcript:spoken,usage:{type:'duration',seconds:2}});
  await vi.waitFor(()=>expect(emitted.filter(e=>(e as {type:string}).type==='response.create')).toHaveLength(2));
  const changedSpoken=`book ${f.service.id} ${f.resource.id} ${date} ${changedAt} Voice Customer voice@example.test`;
  onEvent({type:'conversation.item.input_audio_transcription.completed',item_id:'item_booking_new',transcript:changedSpoken,usage:{type:'duration',seconds:2}});
  const interpretation={intent:'book',slot_changes:[{key:'service_id',op:'set',value:f.service.id,evidence:f.service.id},{key:'resource_id',op:'set',value:f.resource.id,evidence:f.resource.id},{key:'preferred_date',op:'set',value:date,evidence:date},{key:'starts_at',op:'set',value:changedAt,evidence:changedAt},{key:'name',op:'set',value:'Voice Customer',evidence:'Voice Customer'},{key:'email',op:'set',value:'voice@example.test',evidence:'voice@example.test'}],requested_operation:null,question_text:null,uncertain_fields:[]};
  onEvent({type:'response.created',response:{id:'resp_interpret_old',metadata:{response_purpose:'interpretation'}}});onEvent({type:'response.output_item.done',response_id:'resp_interpret_old',item:{type:'function_call',name:'submit_turn',call_id:'call_old',arguments:JSON.stringify(interpretation)}});onEvent({type:'response.done',response:{id:'resp_interpret_old',status:'completed',usage:zero}});
  await vi.waitFor(()=>expect(emitted.filter(e=>(e as {type:string}).type==='response.create')).toHaveLength(3));
  const stale=await one<{count:number}>(f.db,sql`select count(*)::int as count from action_proposals where business_id=${f.business.id} and voice_session_id=${admitted.session.id}`);expect(stale?.count).toBe(0);
  onEvent({type:'response.created',response:{id:'resp_interpret',metadata:{response_purpose:'interpretation'}}});onEvent({type:'response.output_item.done',response_id:'resp_interpret',item:{type:'function_call',name:'submit_turn',call_id:'call_submit',arguments:JSON.stringify(interpretation)}});onEvent({type:'response.done',response:{id:'resp_interpret',status:'completed',usage:zero}});
  await vi.waitFor(async()=>{const row=await one<{status:string;outcome:string|null;engineState:{pending:unknown;directive:string;blockId:string}}>(f.db,sql`select status,outcome,engine_state from voice_sessions where business_id=${f.business.id} and id=${admitted.session.id}`);if(!row?.engineState.pending)throw Error(JSON.stringify({status:row?.status,outcome:row?.outcome,directive:row?.engineState.directive,blockId:row?.engineState.blockId}));});
  const prepared=await one<{engineState:{pending:{readback:string}}}>(f.db,sql`select engine_state from voice_sessions where business_id=${f.business.id} and id=${admitted.session.id}`);
  onEvent({type:'response.created',response:{id:'resp_readback',metadata:{response_purpose:'speech'}}});onEvent({type:'response.output_audio_transcript.done',response_id:'resp_readback',transcript:prepared!.engineState.pending.readback});onEvent({type:'response.done',response:{id:'resp_readback',status:'completed',usage:zero}});onEvent({type:'output_audio_buffer.stopped',response_id:'resp_readback'});
  await vi.waitFor(async()=>{const row=await one<{engineState:{pending:{voiceEligible:boolean}}}>(f.db,sql`select engine_state from voice_sessions where business_id=${f.business.id} and id=${admitted.session.id}`);expect(row?.engineState.pending.voiceEligible).toBe(true);});
  onEvent({type:'conversation.item.input_audio_transcription.completed',item_id:'item_yes',transcript:'yes',usage:{type:'duration',seconds:1}});
  await vi.waitFor(async()=>{const row=await one<{count:number}>(f.db,sql`select count(*)::int as count from appointments where business_id=${f.business.id} and source='owner_test'`);expect(row?.count).toBe(1);});
  const booked=await one<{startsAt:Date}>(f.db,sql`select starts_at from appointments where business_id=${f.business.id} and source='owner_test'`);expect(booked!.startsAt.toISOString()).toBe(new Date(changedAt).toISOString());
  failHangup=true;await expect(lifecycle.end(f.business.id,admitted.session.id,'test_stop')).rejects.toMatchObject({code:'TERMINATION_UNKNOWN'});
  expect((await one<{status:string}>(f.db,sql`select status from voice_sessions where business_id=${f.business.id} and id=${admitted.session.id}`))?.status).toBe('termination_unknown');
  failHangup=false;await lifecycle.end(f.business.id,admitted.session.id,'retry_hangup');expect(hangups).toBe(2);
  const closed=await one<{status:string;usageComplete:boolean;reservedUsd:string}>(f.db,sql`select status,usage_complete,reserved_usd from voice_sessions where business_id=${f.business.id} and id=${admitted.session.id}`);expect(closed?.status).toBe('closed');expect(closed?.usageComplete).toBe(false);expect(Number(closed?.reservedUsd)).toBe(.25);
  await expect(admitLiveOwnerTest(f.db,env,f.business.id,f.user.id,f.selected.snapshot.id,'owner-voice-test-v1')).rejects.toMatchObject({code:'BUDGET_GUARD'});
  lifecycle.close();
 });
 it('deduplicates response usage and retains the first rate snapshot',async()=>{
  const env={...f.env,LIVE_AI_ENABLED:true,OPENAI_API_KEY:'sk-offline-fixture-credential'};
  // An existing closed test session is enough for isolated accounting; it cannot admit another call.
  void env;
  const s=await one<{id:string}>(f.db,sql`select id from voice_sessions where business_id=${f.business.id} and transport='realtime' limit 1`);expect(s).toBeTruthy();
  const usage={input_tokens:10,output_tokens:2,input_token_details:{text_tokens:10,audio_tokens:0,cached_tokens:4,cached_tokens_details:{text_tokens:4,audio_tokens:0}},output_token_details:{text_tokens:2,audio_tokens:0}};
  expect((await persistUsage(f.db,f.business.id,s!.id,'response','resp_fixture',usage,'gpt-realtime-2.1-mini')).recorded).toBe(true);
  expect((await persistUsage(f.db,f.business.id,s!.id,'response','resp_fixture',usage,'gpt-realtime-2.1-mini')).recorded).toBe(false);
  const result=await one<{count:number}>(f.db,sql`select count(*)::int as count from usage_events where business_id=${f.business.id} and session_id=${s!.id} and provider_event_key='resp_fixture'`);expect(result?.count).toBe(1);
 });
});
