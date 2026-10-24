import {beforeAll,afterAll,it,expect} from 'vitest';
import {sql} from 'drizzle-orm';
import {conversationFixture} from './conversation-fixture.js';
import {one,rows,addDays,localParts,type Appointment} from '../src/scheduling/service.js';
import {processTurn,playbackEvent,browserConfirm} from '../src/conversation/controller.js';
import {confirmation} from '../src/conversation/contracts.js';
import {configOf} from '../src/conversation/contracts.js';
import {saveDraft,loadVersion} from '../src/conversation/configuration.js';
let f:Awaited<ReturnType<typeof conversationFixture>>;
beforeAll(async()=>{f=await conversationFixture();});afterAll(async()=>{await f?.cleanup();});
async function pending(hour:number,auto=true){
 const created=await f.start();let s=created.session;const date=addDays(localParts(new Date(),'Asia/Karachi').date,4);const start=`${date}T${String(hour).padStart(2,'0')}:00:00+05:00`;
 s=(await f.send(s.id,s.stateRevision,'book Consultation '+date,{intent:'book',slot_changes:[{key:'service_id',op:'set',value:f.service.id,evidence:'Consultation'},{key:'preferred_date',op:'set',value:date,evidence:date}]})).session;
 s=(await f.send(s.id,s.stateRevision,'Consultant '+start,{slot_changes:[{key:'resource_id',op:'set',value:f.resource.id,evidence:'Consultant'},{key:'starts_at',op:'set',value:start,evidence:start}]})).session;
 s=(await f.send(s.id,s.stateRevision,'Customer customer@example.test',{slot_changes:[{key:'name',op:'set',value:'Customer',evidence:'Customer'},{key:'email',op:'set',value:'customer@example.test',evidence:'customer@example.test'}]},auto)).session;
 expect(s.pending).toBeTruthy();return s;
}
it('core slice commits one real booking only after complete read-back and stores receipt before success',async()=>{
 let s=await pending(9,false);expect((await rows(f.db,sql`select id from appointments where business_id=${f.business.id}`))).toHaveLength(0);
 const p=s.pending!;s=await playbackEvent(f.db,f.env,f.business.id,s.id,(await one<{engineState:{pending:{responseId:string}}}>(f.db,sql`select engine_state from voice_sessions where business_id=${f.business.id} and id=${s.id}`))!.engineState.pending.responseId,'completed',p.readback,true);
 expect(s.pending!.voiceEligible).toBe(true);const confirmed=await f.send(s.id,s.stateRevision,'yes please');expect(confirmed.session.receipts).toHaveLength(1);expect(confirmed.session.receipts[0].simulated).toBe(false);
 const a=await one<Appointment>(f.db,sql`select * from appointments where business_id=${f.business.id}`);expect(a?.status).toBe('confirmed');expect(a?.revision).toBe(1);expect(+a!.endsAt-+a!.startsAt).toBe(1800000);
 const replay=await browserConfirm(f.db,f.env,f.business.id,s.id,p.id,1,s.stateRevision);expect(replay.receipt.recordId).toBe(a!.id);expect((await rows(f.db,sql`select id from appointments where business_id=${f.business.id}`))).toHaveLength(1);
 const messages=await rows<{metadata:{event:string};redactedText:string}>(f.db,sql`select metadata,redacted_text from conversation_messages where business_id=${f.business.id} and session_id=${s.id} order by sequence`);const receiptIndex=messages.findIndex(m=>m.metadata.event==='action_completed');expect(receiptIndex).toBeGreaterThan(-1);expect(messages.slice(0,receiptIndex).some(m=>m.redactedText.includes('Real action committed'))).toBe(false);
});
it('rejects late interpretation after a changed-mind turn and never revives the old proposal',async()=>{
 const s=await pending(10);const old=s.pending!;const date=addDays(localParts(new Date(),'Asia/Karachi').date,5);
 const corrected=await f.send(s.id,s.stateRevision,'Actually '+date,{intent:'correction',slot_changes:[{key:'preferred_date',op:'set',value:date,evidence:date}]});expect(corrected.session.pending).toBeNull();expect(corrected.session.slots.starts_at).toBeUndefined();
 await expect(f.send(s.id,s.stateRevision,'yes')).rejects.toMatchObject({code:'STALE_TURN'});await f.send(s.id,corrected.session.stateRevision,'yes');
 expect((await one<{status:string}>(f.db,sql`select status from action_proposals where business_id=${f.business.id} and id=${old.id}`))!.status).toBe('rejected');expect((await rows(f.db,sql`select id from appointments where business_id=${f.business.id}`))).toHaveLength(1);
});
it('full-turn grammar rejects mixed affirmations and interrupted or incomplete read-back',async()=>{
 for(const yes of ['yes',' YES please! ','confirm.','please confirm','yes confirm'])expect(confirmation(yes)).toBe('accept');for(const no of ['yes, but Friday',"don't confirm",'not yes','yes please tomorrow','confirm Friday','sí'])expect(confirmation(no)).toBe('other');
 const s=await pending(10,false);const early=await f.send(s.id,s.stateRevision,'yes');expect(early.session.receipts).toHaveLength(0);expect(early.session.directive).toContain('CONFIRMATION_REQUIRED');
 const interrupted=await pending(10,false);const raw=await one<{engineState:{pending:{responseId:string}}}>(f.db,sql`select engine_state from voice_sessions where business_id=${f.business.id} and id=${interrupted.id}`);
 const state=await playbackEvent(f.db,f.env,f.business.id,interrupted.id,raw!.engineState.pending.responseId,'interrupted',interrupted.pending!.readback,true);expect(state.pending!.voiceEligible).toBe(false);expect((await f.send(state.id,state.stateRevision,'yes')).session.receipts).toHaveLength(0);
});
it('deduplicates tool identity across a lost response and rolls back a pre-commit crash',async()=>{
 const s=await pending(11);const e={event_id:crypto.randomUUID(),session_id:s.id,input_turn_id:crypto.randomUUID(),expected_state_revision:s.stateRevision,provider_response_id:crypto.randomUUID(),provider_function_call_id:crypto.randomUUID()};
 await expect(processTurn(f.db,f.env,f.business.id,e,'confirm',undefined,{hooks:{beforeCommit:()=>{throw new Error('pre-commit');}}})).rejects.toThrow('pre-commit');expect((await rows(f.db,sql`select id from appointments where business_id=${f.business.id}`))).toHaveLength(1);
 await expect(processTurn(f.db,f.env,f.business.id,e,'confirm',undefined,{hooks:{afterCommit:()=>{throw new Error('lost-response');}}})).rejects.toThrow('lost-response');const replay=await processTurn(f.db,f.env,f.business.id,e,'confirm');expect(replay.replay).toBe(true);expect('managementToken'in replay).toBe(false);expect(replay.session.receipts).toHaveLength(1);expect((await rows(f.db,sql`select id from appointments where business_id=${f.business.id}`))).toHaveLength(2);
});
it('pins an immutable draft snapshot before publication and rejects stale draft saves and cross-tenant sessions',async()=>{
 const original=await loadVersion(f.db,f.business.id,f.selected.snapshot.id);const config=configOf(f.draft);config.flow.blocks.find(x=>x.kind==='Greet')!.settings={greeting:'Changed greeting'};
 await saveDraft(f.db,f.env,f.business.id,{kind:'owner',id:f.user.id},crypto.randomUUID(),1,config);expect((await loadVersion(f.db,f.business.id,original.id)).checksum).toBe(original.checksum);
 await expect(saveDraft(f.db,f.env,f.business.id,{kind:'owner',id:f.user.id},crypto.randomUUID(),1,config)).rejects.toMatchObject({code:'REVISION_CONFLICT'});
 await expect(f.db.execute(sql`update receptionist_config_versions set checksum='tampered' where business_id=${f.business.id} and id=${original.id}`)).rejects.toMatchObject({cause:{code:'23514'}});
 const created=await f.start();await expect(processTurn(f.db,f.env,crypto.randomUUID(),{event_id:crypto.randomUUID(),session_id:created.session.id,input_turn_id:crypto.randomUUID(),expected_state_revision:1,provider_response_id:'r',provider_function_call_id:'f'},'book')).rejects.toMatchObject({code:'NOT_FOUND'});
});
