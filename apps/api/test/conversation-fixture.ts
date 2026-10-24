import {randomUUID} from 'node:crypto';
import {eq} from 'drizzle-orm';
import {createDb} from '../src/db/client.js';
import {readEnv} from '../src/env.js';
import {users,businesses,businessMemberships,businessSettings,schedulingPolicies,resources,services,serviceResources,businessHours} from '../src/db/schema.js';
import {ensureDraft,snapshot} from '../src/conversation/configuration.js';
import {createSession,processTurn} from '../src/conversation/controller.js';
import type {SubmitTurn} from '@bellntell/contracts';
export async function conversationFixture(){
 const env=readEnv();const {db,pool}=createDb(env.DATABASE_URL);const [user]=await db.insert(users).values({email:`conversation-${randomUUID()}@example.test`,name:'Conversation Owner',passwordHash:'not-a-login-credential',recoveryCodeHash:randomUUID()}).returning();
 const [business]=await db.insert(businesses).values({name:'Conversation Test',slug:`conversation-${randomUUID()}`,timezone:'Asia/Karachi'}).returning();
 await db.insert(businessMemberships).values({businessId:business.id,userId:user.id,role:'owner'});await db.insert(businessSettings).values({businessId:business.id,publicPhone:'+923001234567',faqs:[{id:randomUUID(),question:'Do you have parking?',answer:'Parking is available outside.'}]});await db.insert(schedulingPolicies).values({businessId:business.id});
 const [resource]=await db.insert(resources).values({businessId:business.id,displayName:'Consultant'}).returning();const [service]=await db.insert(services).values({businessId:business.id,name:'Consultation',durationMinutes:30,priceText:'PKR 1000'}).returning();await db.insert(serviceResources).values({businessId:business.id,serviceId:service.id,resourceId:resource.id});await db.insert(businessHours).values(Array.from({length:7},(_,weekday)=>({businessId:business.id,weekday,start:'09:00',end:'17:00'})));
 const draft=await ensureDraft(db,business.id,user.id);const selected=await snapshot(db,env,business.id,{kind:'owner',id:user.id},randomUUID(),draft.id,draft.draftRevision);
 const start=()=>createSession(db,env,business.id,user.id,selected.snapshot.id,'integration');
 const send=async(id:string,revision:number,text:string,interpretation?:Partial<SubmitTurn>,completeTextReadback=true)=>processTurn(db,env,business.id,{event_id:randomUUID(),session_id:id,input_turn_id:randomUUID(),expected_state_revision:revision,provider_response_id:randomUUID(),provider_function_call_id:randomUUID()},text,interpretation?{intent:'unknown',slot_changes:[],requested_operation:null,question_text:null,uncertain_fields:[],...interpretation}:undefined,{completeTextReadback});
 const cleanup=async()=>{await db.delete(businesses).where(eq(businesses.id,business.id));await db.delete(users).where(eq(users.id,user.id));await pool.end();};
 return {db,pool,env,user,business,resource,service,draft,selected,start,send,cleanup};
}
