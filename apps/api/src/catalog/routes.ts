import type { FastifyInstance, FastifyRequest } from 'fastify';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { serviceInput, serviceUpdate, resourceInput, resourceUpdate, policyInput, hoursInput, availabilityInput, proposalInput, confirmInput, inquiryUpdate, customerUpdate, appointmentStatus, recoveryReason, listInput, uuid } from '@bellntell/contracts';
import type { Db } from '../db/client.js';
import type { Env } from '../env.js';
import { authorize, requireKey } from '../businesses/routes.js';
import { requireCsrf } from '../auth/routes.js';
import { keyedHash, randomSecret } from '../auth/crypto.js';
import { HttpError, parseBody } from '../http.js';
import { rows, one, required, bumpPolicy, loadSchedule, availability, type Executor, type Service, type Resource, type Policy, type Appointment } from '../scheduling/service.js';
import { prepare, confirm, proposalView, writeOnce, type Actor, type Proposal } from '../actions/service.js';

function id(request:FastifyRequest) {return parseBody(z.object({id:uuid}),request.params).id;}
function revisionMatch(expected:number,actual:number) {if(expected!==actual)throw new HttpError(409,'REVISION_CONFLICT','Record changed; reload and try again');}
export function safeAppointment(a:Appointment) {const {manageTokenHash:_secret,...safe}=a;void _secret;return safe;}
export async function hoursView(tx:Executor,b:string) {
 const schedule=await loadSchedule(tx,b);
 const weekly=Array.from({length:7},(_,weekday)=>({weekday,intervals:schedule.hours.filter(x=>x.weekday===weekday).map(x=>({start:x.start.slice(0,5),end:x.end.slice(0,5)}))}));
 const scopes=new Map<string,{date:string;resourceId:string|null;closed:boolean;intervals:{start:string;end:string}[]}>();
 for(const x of schedule.overrides){const key=`${x.resourceId}:${x.localDate}`;const row=scopes.get(key)??{date:x.localDate,resourceId:x.resourceId,closed:x.kind==='closed',intervals:[]};if(x.kind==='open')row.intervals.push({start:x.start!.slice(0,5),end:x.end!.slice(0,5)});scopes.set(key,row);}
 return {revision:schedule.policy.revision,weekly,overrides:[...scopes.values()]};
}
export function registerOperationsRoutes(app:FastifyInstance,db:Db,env:Env) {
 const base='/api/v1/businesses/:b';
 async function writer(request:FastifyRequest,minimum:'manager'|'owner'='manager') {
  const context=await authorize(request,db,env,minimum);requireCsrf(request,env,context.auth);
  return {b:context.businessId,actor:{kind:'owner',id:context.auth.user.id,owner:context.role==='owner'} as Actor,key:requireKey(request)};
 }
 for(const kind of ['services','resources'] as const) {
  app.get(`${base}/${kind}`,async request=>{
   const {businessId:b}=await authorize(request,db,env,'viewer');const page=parseBody(listInput,request.query);
   let cursor:string|null=null;
   if(page.cursor){try{cursor=parseBody(uuid,Buffer.from(page.cursor,'base64url').toString());}catch{throw new HttpError(400,'VALIDATION_ERROR','Invalid cursor');}}
   const items=await rows<Service|Resource>(db,sql`select * from ${sql.raw(kind)} where business_id=${b} ${cursor?sql`and id<${cursor}::uuid`:sql``} order by id desc limit ${page.limit+1}`);
   const hasMore=items.length>page.limit;items.splice(page.limit);
   const eligible=kind==='services'?await rows<{serviceId:string;resourceId:string}>(db,sql`select service_id,resource_id from service_resources where business_id=${b}`):[];
   return {[kind]:items.map(x=>kind==='services'?{...x,resourceIds:eligible.filter(y=>y.serviceId===x.id).map(y=>y.resourceId)}:x),nextCursor:hasMore?Buffer.from(items.at(-1)!.id).toString('base64url'):null};
  });
  for(const method of ['POST','PATCH'] as const) app.route({method,url:method==='POST'?`${base}/${kind}`:`${base}/${kind}/:id`,handler:async request=>{
   const {b,actor,key}=await writer(request);
   if(kind==='services') {
    const input=parseBody(method==='POST'?serviceInput:serviceUpdate,request.body);const target=method==='PATCH'?id(request):crypto.randomUUID();
    return (await writeOnce(db,env,b,actor,key,`${kind}.${method}`,{target:method==='PATCH'?target:null,input},async tx=>{
     if(method==='PATCH'){const old=required(await one<Service>(tx,sql`select * from services where business_id=${b} and id=${target}`));revisionMatch('revision' in input ? Number(input.revision):0,old.revision);}
     for(const resourceId of input.resourceIds)required(await one(tx,sql`select id from resources where business_id=${b} and id=${resourceId}`));
     const service=method==='POST'?required(await one<Service>(tx,sql`insert into services (id,business_id,name,duration_minutes,public_description,price_text,active) values (${target},${b},${input.name},${input.durationMinutes},${input.publicDescription},${input.priceText},${input.active}) returning *`)):required(await one<Service>(tx,sql`update services set name=${input.name},duration_minutes=${input.durationMinutes},public_description=${input.publicDescription},price_text=${input.priceText},active=${input.active},revision=revision+1 where business_id=${b} and id=${target} returning *`));
     await tx.execute(sql`delete from service_resources where business_id=${b} and service_id=${target}`);
     for(const resourceId of input.resourceIds)await tx.execute(sql`insert into service_resources (business_id,service_id,resource_id) values (${b},${target},${resourceId})`);
     await bumpPolicy(tx,b);return {result:{service:{...service,resourceIds:input.resourceIds}}};
    })).result;
   }
   const input=parseBody(method==='POST'?resourceInput:resourceUpdate,request.body);const target=method==='PATCH'?id(request):crypto.randomUUID();
   return (await writeOnce(db,env,b,actor,key,`${kind}.${method}`,{target:method==='PATCH'?target:null,input},async tx=>{
    if(method==='PATCH'){const old=required(await one<Resource>(tx,sql`select * from resources where business_id=${b} and id=${target}`));revisionMatch('revision' in input?Number(input.revision):0,old.revision);}
    const resource=method==='POST'?required(await one<Resource>(tx,sql`insert into resources (id,business_id,display_name,active) values (${target},${b},${input.displayName},${input.active}) returning *`)):required(await one<Resource>(tx,sql`update resources set display_name=${input.displayName},active=${input.active},revision=revision+1 where business_id=${b} and id=${target} returning *`));
    await bumpPolicy(tx,b);return {result:{resource}};
   })).result;
  }});
 }
 app.get(`${base}/scheduling-policy`,async request=> {const {businessId:b}=await authorize(request,db,env,'viewer');return {policy:required(await one<Policy>(db,sql`select * from scheduling_policies where business_id=${b}`))};});
 app.put(`${base}/scheduling-policy`,async request=> {
  const {b,actor,key}=await writer(request);const input=parseBody(policyInput,request.body);
  return (await writeOnce(db,env,b,actor,key,'policy.update',input,async(tx,policy)=>{revisionMatch(input.revision,policy.revision);return {result:{policy:required(await one<Policy>(tx,sql`update scheduling_policies set slot_minutes=${input.slotMinutes},notice_minutes=${input.noticeMinutes},horizon_days=${input.horizonDays},cutoff_minutes=${input.cutoffMinutes},revision=revision+1 where business_id=${b} returning *`))}};})).result;
 });
 app.get(`${base}/hours`,async request=>{const {businessId:b}=await authorize(request,db,env,'viewer');return hoursView(db,b);});
 app.put(`${base}/hours`,async request=> {
  const {b,actor,key}=await writer(request);const input=parseBody(hoursInput,request.body);
  return (await writeOnce(db,env,b,actor,key,'hours.update',input,async(tx,policy)=>{
   revisionMatch(input.revision,policy.revision);
   for(const x of input.overrides)if(x.resourceId)required(await one(tx,sql`select id from resources where business_id=${b} and id=${x.resourceId}`));
   await tx.execute(sql`delete from business_hours where business_id=${b}`);await tx.execute(sql`delete from availability_overrides where business_id=${b}`);
   for(const day of input.weekly)for(const x of day.intervals)await tx.execute(sql`insert into business_hours (business_id,weekday,start,"end") values (${b},${day.weekday},${x.start},${x.end})`);
   for(const day of input.overrides){if(day.closed)await tx.execute(sql`insert into availability_overrides (business_id,resource_id,local_date,kind) values (${b},${day.resourceId},${day.date},'closed')`);else for(const x of day.intervals)await tx.execute(sql`insert into availability_overrides (business_id,resource_id,local_date,kind,start,"end") values (${b},${day.resourceId},${day.date},'open',${x.start},${x.end})`);}
   await bumpPolicy(tx,b);return {result:await hoursView(tx,b)};
  })).result;
 });
 app.get(`${base}/availability`,async request=>{const {businessId:b}=await authorize(request,db,env,'viewer');const input=parseBody(availabilityInput,request.query);return {candidates:availability(await loadSchedule(db,b),input)};});
 app.post(`${base}/action-proposals`,async request=> {const {b,actor,key}=await writer(request);const input=parseBody(proposalInput,request.body);if('overrideReason' in input&&input.overrideReason&&!actor.owner)throw new HttpError(403,'FORBIDDEN','Only the owner can override the management cutoff');return {proposal:await proposalView(db,b,await prepare(db,env,b,actor,key,input))};});
 app.get(`${base}/action-proposals/:id`,async request=> {const {auth,businessId:b}=await authorize(request,db,env,'manager');const p=required(await one<Proposal>(db,sql`select * from action_proposals where business_id=${b} and id=${id(request)} and actor_kind='owner' and actor_id=${auth.user.id}`));return {proposal:await proposalView(db,b,p)};});
 app.post(`${base}/action-proposals/:id/confirm`,async request=> {const {b,actor}=await writer(request);const input=parseBody(confirmInput,request.body);return confirm(db,env,b,actor,id(request),input.revision);});
 app.post(`${base}/action-proposals/:id/reject`,async request=>{const {b,actor}=await writer(request);parseBody(z.strictObject({}),request.body);const p=await one(txDb(db),sql`update action_proposals set status='rejected',revision=revision+1,payload='{}'::jsonb where business_id=${b} and id=${id(request)} and actor_kind=${actor.kind} and actor_id=${actor.id} and status='prepared' returning id`);required(p);return {ok:true};});
 for(const table of ['appointments','customers','inquiries'] as const) {
  app.get(`${base}/${table}`,async request=> {
   const {businessId:b}=await authorize(request,db,env,'viewer');const page=parseBody(listInput,request.query);let cursor:string|null=null;
   if(page.cursor){try{cursor=parseBody(uuid,Buffer.from(page.cursor,'base64url').toString());}catch{throw new HttpError(400,'VALIDATION_ERROR','Invalid cursor');}}
   const items=await rows<Appointment&Record<string,unknown>>(db,sql`select * from ${sql.raw(table)} where business_id=${b} ${cursor?sql`and id<${cursor}::uuid`:sql``} order by id desc limit ${page.limit+1}`);const more=items.length>page.limit;items.splice(page.limit);
   return {[table]:items.map(x=>table==='appointments'?safeAppointment(x):x),nextCursor:more?Buffer.from(items.at(-1)!.id).toString('base64url'):null};
  });
  app.get(`${base}/${table}/:id`,async request=> {const {businessId:b}=await authorize(request,db,env,'viewer');const item=required(await one<Appointment&Record<string,unknown>>(db,sql`select * from ${sql.raw(table)} where business_id=${b} and id=${id(request)}`));return {[table.slice(0,-1)]:table==='appointments'?safeAppointment(item):item};});
 }
 app.patch(`${base}/customers/:id`,async request=> {
  const {b,actor,key}=await writer(request);const input=parseBody(customerUpdate,request.body);const target=id(request);
  return (await writeOnce(db,env,b,actor,key,'customer.update',{target,input},async tx=>{const old=required(await one<{revision:number}>(tx,sql`select revision from customers where business_id=${b} and id=${target} for update`));revisionMatch(input.revision,old.revision);return {result:{customer:required(await one(tx,sql`update customers set name=${input.contact.name},phone_e164=${input.contact.phone},email=${input.contact.email},revision=revision+1 where business_id=${b} and id=${target} returning *`))}};})).result;
 });
 app.patch(`${base}/inquiries/:id`,async request=> {
  const {b,actor,key}=await writer(request);const input=parseBody(inquiryUpdate,request.body);const target=id(request);
  return (await writeOnce(db,env,b,actor,key,'inquiry.update',{target,input},async tx=>{const old=required(await one<{revision:number}>(tx,sql`select revision from inquiries where business_id=${b} and id=${target} for update`));revisionMatch(input.revision,old.revision);return {result:{inquiry:required(await one(tx,sql`update inquiries set status=${input.status},owner_note=${input.ownerNote},revision=revision+1,updated_at=now() where business_id=${b} and id=${target} returning *`))}};})).result;
 });
 app.patch(`${base}/appointments/:id/status`,async request=> {
  const {b,actor,key}=await writer(request);const input=parseBody(appointmentStatus,request.body);const target=id(request);
  return (await writeOnce(db,env,b,actor,key,'appointment.status',{target,input},async tx=>{const old=required(await one<Appointment>(tx,sql`select * from appointments where business_id=${b} and id=${target} for update`));revisionMatch(input.revision,old.revision);if(+old.startsAt>Date.now()||old.status!=='confirmed')throw new HttpError(409,'POLICY_DENIED','Only a started, confirmed appointment can be completed or marked no-show');return {result:{appointment:safeAppointment(required(await one<Appointment>(tx,sql`update appointments set status=${input.status},revision=revision+1,updated_at=now() where business_id=${b} and id=${target} returning *`)))}};})).result;
 });
 app.post(`${base}/appointments/:id/management-token`,async request=> {
  const {b,actor,key}=await writer(request,'owner');const input=parseBody(recoveryReason,request.body);const target=id(request);
  const result=await writeOnce(db,env,b,actor,key,'management.reissue',{target,input},async tx=>{const token=randomSecret();const appointment=required(await one<Appointment>(tx,sql`update appointments set manage_token_hash=${keyedHash(env.AUTH_HASH_KEY,'management',token)},revision=revision+1,updated_at=now() where business_id=${b} and id=${target} returning *`));const {audit}=await import('../scheduling/service.js');await audit(tx,b,actor.kind,actor.id,'management.recovery','appointment',target,{reason:input.reason});return {result:{appointment:safeAppointment(appointment)},secret:token};});
  return {...result.result,...(result.secret?{managementToken:result.secret}:{})};
 });
}
function txDb(db:Db):Executor{return db;}
