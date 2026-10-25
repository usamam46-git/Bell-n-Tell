import {randomUUID} from 'node:crypto';
import {sql} from 'drizzle-orm';
import {conversationConfig,type ConversationConfig} from '@bellntell/contracts';
import type {Db} from '../db/client.js';
import type {Env} from '../env.js';
import {HttpError} from '../http.js';
import {writeOnce,type Actor} from '../actions/service.js';
import {availability,addDays,localParts,loadSchedule,lockPolicy,one,required,type Executor} from '../scheduling/service.js';
import {checksum,defaultConfig,validateConfig} from './validator.js';
import {configOf,type Version,type Fixture} from './contracts.js';
export async function draft(tx:Executor,b:string):Promise<Version>{return required(await one<Version>(tx,sql`select v.* from receptionist_configs c join receptionist_config_versions v on v.business_id=c.business_id and v.id=c.draft_version_id where c.business_id=${b}`));}
export async function ensureDraft(db:Db,b:string,userId:string){return db.transaction(async tx=>{
 await lockPolicy(tx,b);const existing=await one(tx,sql`select business_id from receptionist_configs where business_id=${b}`);if(existing)return draft(tx,b);
 const schedule=await loadSchedule(tx,b);if(!schedule.services.some(x=>x.active))throw new HttpError(409,'SETUP_REQUIRED','Add an active service before creating the receptionist draft');
 const content=required(await one<ConversationConfig['content']>(tx,sql`select faqs,public_email,public_phone,public_address,public_description from business_settings where business_id=${b}`));
 const config=defaultConfig(schedule,content);const version=required(await one<Version>(tx,sql`insert into receptionist_config_versions (business_id,status,flow,policy,content,checksum,created_by) values (${b},'draft',${JSON.stringify(config.flow)}::jsonb,${JSON.stringify(config.policy)}::jsonb,${JSON.stringify(config.content)}::jsonb,${checksum(config)},${userId}) returning *`));
 await tx.execute(sql`insert into receptionist_configs (business_id,draft_version_id) values (${b},${version.id})`);return version;
});}
export async function saveDraft(db:Db,env:Env,b:string,actor:Actor,key:string,expected:number,input:unknown){
 const parsed=conversationConfig.safeParse(input);if(!parsed.success)throw new HttpError(400,'VALIDATION_ERROR',parsed.error.issues.map(x=>`${x.path.join('.')}: ${x.message}`).join('; '));
 return (await writeOnce(db,env,b,actor,key,'draft.save',{expected,input:parsed.data},async tx=>{
  const current=await draft(tx,b);if(current.draftRevision!==expected)throw new HttpError(409,'REVISION_CONFLICT','Draft changed; reload before saving');
  const value=parsed.data;const saved=required(await one<Version>(tx,sql`update receptionist_config_versions set flow=${JSON.stringify(value.flow)}::jsonb,policy=${JSON.stringify(value.policy)}::jsonb,content=${JSON.stringify(value.content)}::jsonb,checksum=${checksum(value)},draft_revision=draft_revision+1 where business_id=${b} and id=${current.id} and status='draft' returning *`));
  return {result:{draft:saved,issues:validateConfig(value,await loadSchedule(tx,b))}};
 })).result;
}
export async function snapshot(db:Db,env:Env,b:string,actor:Actor,key:string,draftId:string,revision:number){
 return (await writeOnce(db,env,b,actor,key,'draft.snapshot',{draftId,revision},async tx=>{
  const current=await draft(tx,b);if(current.id!==draftId||current.draftRevision!==revision)throw new HttpError(409,'REVISION_CONFLICT','Select the current draft revision');
  const schedule=await loadSchedule(tx,b);const config=configOf(current);const issues=validateConfig(config,schedule);if(issues.length)throw new HttpError(400,'CONFIG_INVALID',issues.map(x=>`${x.path}: ${x.message}`).join('; '));
  // Copy only public catalog, hours and policy. Add one synthetic occupied slot when possible.
  const now=new Date();const synthetic={...schedule,busy:[] as typeof schedule.busy};const service=schedule.services.find(x=>x.active);
  if(service){const date=addDays(localParts(now,schedule.business.timezone).date,4);const candidate=availability(synthetic,{serviceId:service.id,from:date,to:date},now)[0];if(candidate)synthetic.busy=[{id:randomUUID(),resourceId:candidate.resourceId,startsAt:new Date(candidate.startsAt),endsAt:new Date(candidate.endsAt)}];}
  const fixture:Fixture={schedule:synthetic,now:now.toISOString()};
  const row=required(await one<Version>(tx,sql`insert into receptionist_config_versions (business_id,draft_revision,source_draft_id,source_draft_revision,status,flow,policy,content,test_fixture,checksum,created_by) values (${b},${revision},${current.id},${revision},'test_snapshot',${JSON.stringify(config.flow)}::jsonb,${JSON.stringify(config.policy)}::jsonb,${JSON.stringify(config.content)}::jsonb,${JSON.stringify(fixture)}::jsonb,${checksum(config)},${actor.id}) returning *`));
  return {result:{snapshot:{id:row.id,checksum:row.checksum,sourceDraftId:row.sourceDraftId,sourceDraftRevision:row.sourceDraftRevision,status:row.status}}};
 })).result;
}
export async function loadVersion(tx:Executor,b:string,id:string){return required(await one<Version>(tx,sql`select * from receptionist_config_versions where business_id=${b} and id=${id} and status='test_snapshot'`));}
