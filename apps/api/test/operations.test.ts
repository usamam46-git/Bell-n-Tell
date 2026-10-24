import {afterAll,beforeAll,describe,it,expect} from 'vitest';
import {sql,eq} from 'drizzle-orm';
import {createDb} from '../src/db/client.js';
import {readEnv} from '../src/env.js';
import {buildApp} from '../src/app.js';
import {businesses,users,businessMemberships} from '../src/db/schema.js';
import {one,rows,loadSchedule,localInstants,slot,addDays,localParts,type Appointment} from '../src/scheduling/service.js';
import {confirm,prepare,expireProposals,type Proposal,type Receipt} from '../src/actions/service.js';
import {keyedHash} from '../src/auth/crypto.js';

const env=readEnv();const {db,pool}=createDb(env.DATABASE_URL);const app=await buildApp(db,env);
const nonce=crypto.randomUUID();const origin={origin:env.WEB_ORIGIN,'content-type':'application/json'};
type Owner={id:string;cookie:string;csrf:string;b:string;slug:string};
let owner:Owner,other:Owner;let resourceId='',serviceId='';
const day=addDays(localParts(new Date(),'Asia/Karachi').date,4);
const time=(hour:number,date=day)=>new Date(`${date}T${String(hour).padStart(2,'0')}:00:00+05:00`).toISOString();
const contact={name:'  Booking Customer  ',phone:'+923001234567',email:'  CUSTOMER@EXAMPLE.TEST  '};
async function call(method:'GET'|'POST'|'PATCH'|'PUT',path:string,body?:unknown,as:Owner|undefined=owner,key=crypto.randomUUID(),headers:Record<string,string>={}) {
 return app.inject({method,url:'/api/v1'+path,headers:{...origin,...(as?{cookie:as.cookie,'x-csrf-token':as.csrf}:{}),'idempotency-key':key,...headers},...(body===undefined?{}:{payload:JSON.stringify(body)})});
}
async function account(suffix:string):Promise<Owner> {
 const registration=await call('POST','/auth/register',{name:'Operations Owner',email:`ops-${suffix}-${nonce}@example.test`,password:'correct horse battery stable 34'},undefined);
 expect(registration.statusCode).toBe(201);const data=registration.json();const cookie=registration.cookies[0].name+'='+registration.cookies[0].value;
 const as={id:data.user.id,cookie,csrf:data.csrfToken,b:'',slug:`ops-${suffix}-${nonce}`};
 const created=await call('POST','/businesses',{name:'Operations Test',slug:as.slug,timezone:'Asia/Karachi'},as);expect(created.statusCode).toBe(201);as.b=created.json().business.id;return as;
}
async function proposal(body:unknown,as=owner,key=crypto.randomUUID()) {const r=await call('POST',`/businesses/${as.b}/action-proposals`,body,as,key);expect(r.statusCode,r.body).toBe(200);return r.json().proposal as Proposal;}
async function book(hour:number) {const p=await proposal({kind:'book',serviceId,resourceId,startsAt:time(hour),contact});const r=await call('POST',`/businesses/${owner.b}/action-proposals/${p.id}/confirm`,{revision:p.revision,confirm:true});expect(r.statusCode,r.body).toBe(200);return r.json() as {receipt:Receipt;managementToken:string};}
beforeAll(async()=>{
 await app.ready();owner=await account('a');other=await account('b');
 const resource=await call('POST',`/businesses/${owner.b}/resources`,{displayName:'Primary Resource'});expect(resource.statusCode,resource.body).toBe(200);resourceId=resource.json().resource.id;
 const service=await call('POST',`/businesses/${owner.b}/services`,{name:'Consultation',resourceIds:[resourceId],priceText:'PKR 1000'});expect(service.statusCode,service.body).toBe(200);serviceId=service.json().service.id;
 const policy=await call('GET',`/businesses/${owner.b}/scheduling-policy`);expect(policy.json().policy).toMatchObject({slotMinutes:15,noticeMinutes:60,horizonDays:60,cutoffMinutes:1440});
 const hours=await call('PUT',`/businesses/${owner.b}/hours`,{revision:policy.json().policy.revision,weekly:Array.from({length:7},(_,weekday)=>({weekday,intervals:[{start:'09:00',end:'18:00'}]})),overrides:[]});expect(hours.statusCode,hours.body).toBe(200);
});
afterAll(async()=>{for(const as of [owner,other])if(as){await db.delete(businesses).where(eq(businesses.id,as.b));await db.delete(users).where(eq(users.id,as.id));}await app.close();await pool.end();});
describe('Phase 2 PostgreSQL operations',()=>{
 it('replays setup writes, rejects changed keys/unknown fields and enforces scoped resources',async()=>{
  const key=crypto.randomUUID();const path=`/businesses/${owner.b}/resources`;const first=await call('POST',path,{displayName:'Secondary'},owner,key);const replay=await call('POST',path,{displayName:'Secondary'},owner,key);expect(first.json()).toEqual(replay.json());
  expect((await call('POST',path,{displayName:'Changed'},owner,key)).json().error.code).toBe('IDEMPOTENCY_CONFLICT');
  expect((await call('POST',path,{displayName:'Extra',businessId:other.b})).statusCode).toBe(400);
  expect((await call('GET',`/businesses/${owner.b}/services`,undefined,other)).statusCode).toBe(404);
  expect((await call('POST',`/businesses/${other.b}/services`,{name:'Foreign',resourceIds:[resourceId]},other)).statusCode).toBe(404);
  expect((await call('POST',path,{displayName:'No csrf'},owner,crypto.randomUUID(),{'x-csrf-token':''})).statusCode).toBe(403);
 });
 it('books with exact confirmation, replays one durable receipt and stores only a token hash',async()=>{
  const p=await proposal({kind:'book',serviceId,resourceId,startsAt:time(9),contact});
  const missing=await call('POST',`/businesses/${owner.b}/action-proposals/${p.id}/confirm`,{revision:1});expect(missing.statusCode).toBe(400);
  const [a,b]=await Promise.all([call('POST',`/businesses/${owner.b}/action-proposals/${p.id}/confirm`,{revision:1,confirm:true}),call('POST',`/businesses/${owner.b}/action-proposals/${p.id}/confirm`,{revision:1,confirm:true})]);
  expect(a.statusCode,a.body).toBe(200);expect(b.statusCode,b.body).toBe(200);expect(a.json().receipt).toEqual(b.json().receipt);expect([a.json(),b.json()].filter(x=>x.managementToken)).toHaveLength(1);
  const row=await one<Appointment>(db,sql`select * from appointments where business_id=${owner.b} and id=${a.json().receipt.recordId}`);expect(row?.revision).toBe(1);expect(+row!.endsAt-+row!.startsAt).toBe(30*60000);
  const secret=a.json().managementToken??b.json().managementToken;expect(row!.manageTokenHash).toBe(keyedHash(env.AUTH_HASH_KEY,'management',secret));
  const persisted=await one<{text:string}>(db,sql`select row_to_json(action_proposals)::text as text from action_proposals where business_id=${owner.b} and id=${p.id}`);expect(persisted!.text).not.toContain(secret);
  const list=await call('GET',`/businesses/${owner.b}/appointments`);expect(list.body).not.toContain(row!.manageTokenHash);expect(list.body).not.toContain(secret);
  expect((await call('PATCH',`/businesses/${owner.b}/appointments/${row!.id}/status`,{revision:1,status:'completed'})).json().error.code).toBe('POLICY_DENIED');
  expect((await call('PATCH',`/businesses/${owner.b}`,{revision:1,timezone:'UTC'})).json().error.code).toBe('POLICY_DENIED');
 });
 it('serializes overlapping proposal confirmations and independently enforces the SQL exclusion constraint',async()=>{
  const payload={kind:'book',serviceId,resourceId,startsAt:time(10),contact};const p1=await proposal(payload);const p2=await proposal(payload);
  const results=await Promise.all([p1,p2].map(p=>call('POST',`/businesses/${owner.b}/action-proposals/${p.id}/confirm`,{revision:1,confirm:true})));expect(results.map(r=>r.statusCode).sort()).toEqual([200,409]);expect(results.find(r=>r.statusCode===409)!.json().error.code).toBe('SLOT_UNAVAILABLE');
  const existing=await one<Appointment>(db,sql`select * from appointments where business_id=${owner.b} and starts_at=${new Date(time(10))}`);
  await expect(db.execute(sql`insert into appointments (business_id,customer_id,service_id,resource_id,starts_at,ends_at,timezone,service_name,duration_minutes,price_text,source,booking_ref,manage_token_hash) values (${owner.b},${existing!.customerId},${serviceId},${resourceId},${existing!.startsAt},${existing!.endsAt},'Asia/Karachi','Conflict',30,'','owner',${crypto.randomUUID()},'hash')`)).rejects.toMatchObject({cause:{code:'23P01'}});
  expect((await rows(db,sql`select id from appointments where business_id=${owner.b} and starts_at=${new Date(time(10))}`))).toHaveLength(1);
  const raceStart=new Date(time(9,addDays(day,1)));const raceEnd=new Date(+raceStart+1800000);
  const direct=await Promise.allSettled([1,2].map(()=>db.execute(sql`insert into appointments (business_id,customer_id,service_id,resource_id,starts_at,ends_at,timezone,service_name,duration_minutes,price_text,source,booking_ref,manage_token_hash) values (${owner.b},${existing!.customerId},${serviceId},${resourceId},${raceStart},${raceEnd},'Asia/Karachi','Direct race',30,'','owner',${crypto.randomUUID()},'hash')`)));
  expect(direct.filter(x=>x.status==='fulfilled')).toHaveLength(1);expect(direct.filter(x=>x.status==='rejected')).toHaveLength(1);
 });
 it('rolls back a crash before commit and recovers the receipt after a committed response is lost',async()=>{
  const actor={kind:'owner' as const,id:owner.id,owner:true};const p=await prepare(db,env,owner.b,actor,crypto.randomUUID(),{kind:'book',serviceId,resourceId,startsAt:time(11),contact:{name:'Crash Test',phone:'+923001234567',email:null}});
  await expect(confirm(db,env,owner.b,actor,p.id,1,{beforeCommit:()=>{throw new Error('Injected pre-commit crash');}})).rejects.toThrow('Injected pre-commit crash');
  expect(await one(db,sql`select id from appointments where business_id=${owner.b} and starts_at=${new Date(time(11))}`)).toBeUndefined();
  await expect(confirm(db,env,owner.b,actor,p.id,1,{afterCommit:()=>{throw new Error('Injected lost response');}})).rejects.toThrow('Injected lost response');
  const freshApp=await buildApp(db,env);const replay=await freshApp.inject({method:'POST',url:`/api/v1/businesses/${owner.b}/action-proposals/${p.id}/confirm`,headers:{...origin,cookie:owner.cookie,'x-csrf-token':owner.csrf,'idempotency-key':crypto.randomUUID()},payload:{revision:1,confirm:true}});expect(replay.statusCode,replay.body).toBe(200);expect(replay.json().managementToken).toBeUndefined();expect((await rows(db,sql`select id from appointments where business_id=${owner.b} and starts_at=${new Date(time(11))}`))).toHaveLength(1);await freshApp.close();
 });
 it('rejects stale policy/appointment revisions, expired proposals and changed request keys',async()=>{
  const key=crypto.randomUUID();const p=await proposal({kind:'book',serviceId,resourceId,startsAt:time(12),contact},owner,key);
  expect((await call('POST',`/businesses/${owner.b}/action-proposals`,{kind:'book',serviceId,resourceId,startsAt:time(13),contact},owner,key)).json().error.code).toBe('IDEMPOTENCY_CONFLICT');
  const policy=(await call('GET',`/businesses/${owner.b}/scheduling-policy`)).json().policy;
  const changed=await call('PUT',`/businesses/${owner.b}/scheduling-policy`,{revision:policy.revision,slotMinutes:15,noticeMinutes:60,horizonDays:60,cutoffMinutes:1440});expect(changed.statusCode).toBe(200);
  expect((await call('POST',`/businesses/${owner.b}/action-proposals/${p.id}/confirm`,{revision:1,confirm:true})).json().error.code).toBe('STALE_PROPOSAL');
  const expired=await proposal({kind:'book',serviceId,resourceId,startsAt:time(12),contact});await db.execute(sql`update action_proposals set expires_at=now()-interval '1 second' where business_id=${owner.b} and id=${expired.id}`);
  expect((await call('POST',`/businesses/${owner.b}/action-proposals/${expired.id}/confirm`,{revision:1,confirm:true})).statusCode).toBe(410);
  await expireProposals(db);const swept=await one<Proposal>(db,sql`select * from action_proposals where business_id=${owner.b} and id=${expired.id}`);expect(swept?.status).toBe('expired');expect(swept?.payload).toEqual({});
  const booked=await book(12);const cancel=await proposal({kind:'cancel',appointmentId:booked.receipt.recordId,appointmentRevision:1});const moved=await proposal({kind:'reschedule',appointmentId:booked.receipt.recordId,appointmentRevision:1,resourceId,startsAt:time(13)});
  expect((await call('POST',`/businesses/${owner.b}/action-proposals/${moved.id}/confirm`,{revision:1,confirm:true})).statusCode).toBe(200);
  expect((await call('POST',`/businesses/${owner.b}/action-proposals/${cancel.id}/confirm`,{revision:1,confirm:true})).json().error.code).toBe('STALE_PROPOSAL');
  const final=await proposal({kind:'cancel',appointmentId:booked.receipt.recordId,appointmentRevision:2});const cancelled=await call('POST',`/businesses/${owner.b}/action-proposals/${final.id}/confirm`,{revision:1,confirm:true});expect(cancelled.statusCode,cancelled.body).toBe(200);expect((await one<Appointment>(db,sql`select * from appointments where business_id=${owner.b} and id=${booked.receipt.recordId}`))!.status).toBe('cancelled');
 });
 it('keeps public inquiry provider-independent, idempotent and distinct from contact history',async()=>{
  const key=crypto.randomUUID();const payload={contact,summary:'Please call about a consultation',type:'callback',consentVersion:'contact-v1',consent:true};const path=`/public/${owner.slug}/inquiries`;
  const first=await call('POST',path,payload,undefined,key);const replay=await call('POST',path,payload,undefined,key);expect(first.statusCode,first.body).toBe(200);expect(first.json()).toEqual(replay.json());
  expect((await call('POST',path,{...payload,consent:false},undefined)).statusCode).toBe(400);
  expect((await call('POST',path,{...payload,summary:'Different'},undefined,key)).json().error.code).toBe('IDEMPOTENCY_CONFLICT');
  const inquiry=first.json().receipt;expect((await call('PATCH',`/businesses/${owner.b}/inquiries/${inquiry.recordId}`,{revision:1,status:'in_progress',ownerNote:'Owner will call'})).statusCode).toBe(200);expect((await call('PATCH',`/businesses/${owner.b}/inquiries/${inquiry.recordId}`,{revision:2,status:'resolved',ownerNote:'Called'})).statusCode).toBe(200);
  expect((await rows(db,sql`select id from customers where business_id=${owner.b} and phone_e164=${contact.phone}`)).length).toBeGreaterThan(1);
  expect((await call('GET',`/businesses/${owner.b}/inquiries/${inquiry.recordId}`,undefined,other)).statusCode).toBe(404);
 });
 it('binds private management proof to browser/tenant/expiry, revokes it on recovery, and persists guessing budgets',async()=>{
  const booking=await book(14);const path=`/public/${owner.slug}`;const verify=await call('POST',path+'/appointment-verifications',{reference:booking.receipt.bookingRef,token:booking.managementToken},undefined);expect(verify.statusCode,verify.body).toBe(200);
  const data=verify.json();const cookie=verify.cookies[0].name+'='+verify.cookies[0].value;const headers={cookie,'x-management-handle':data.handle,'x-csrf-token':data.csrfToken};
  expect((await call('GET',path+'/managed-appointment',undefined,undefined,crypto.randomUUID(),headers)).statusCode).toBe(200);
  expect((await call('GET',path+'/managed-appointment',undefined,undefined,crypto.randomUUID(),{'x-management-handle':data.handle})).statusCode).toBe(403);
  expect((await call('GET',`/public/${other.slug}/managed-appointment`,undefined,undefined,crypto.randomUUID(),headers)).statusCode).toBe(403);
  const [handleBody]=data.handle.split('.');const expiredBody=Buffer.from(JSON.stringify({...JSON.parse(Buffer.from(handleBody,'base64url').toString()),expires:Date.now()-1})).toString('base64url');const expiredHandle=expiredBody+'.'+keyedHash(env.AUTH_HASH_KEY,'management-handle',expiredBody);
  expect((await call('GET',path+'/managed-appointment',undefined,undefined,crypto.randomUUID(),{...headers,'x-management-handle':expiredHandle})).statusCode).toBe(403);
  const prepared=await call('POST',path+'/action-proposals',{handle:data.handle,action:{kind:'reschedule',appointmentRevision:1,resourceId,startsAt:time(15)}},undefined,crypto.randomUUID(),headers);expect(prepared.statusCode,prepared.body).toBe(200);
  const committed=await call('POST',path+`/action-proposals/${prepared.json().proposal.id}/confirm`,{handle:data.handle,revision:1,confirm:true},undefined,crypto.randomUUID(),headers);expect(committed.statusCode,committed.body).toBe(200);
  const rotated=await call('POST',`/businesses/${owner.b}/appointments/${booking.receipt.recordId}/management-token`,{reason:'Verified customer through established offline process'});expect(rotated.statusCode,rotated.body).toBe(200);
  expect((await call('GET',path+'/managed-appointment',undefined,undefined,crypto.randomUUID(),headers)).statusCode).toBe(403);
  expect((await call('POST',path+'/appointment-verifications',{reference:booking.receipt.bookingRef,token:booking.managementToken},undefined)).statusCode).toBe(403);
  const ref='unknown-'+crypto.randomUUID();for(let n=0;n<5;n++)expect((await call('POST',path+'/appointment-verifications',{reference:ref,token:'wrong-token-is-long-enough'},undefined)).statusCode).toBe(403);
  const restarted=await buildApp(db,env);const limited=await restarted.inject({method:'POST',url:'/api/v1'+path+'/appointment-verifications',headers:origin,payload:{reference:ref,token:'wrong-token-is-long-enough'}});expect(limited.statusCode).toBe(429);await restarted.close();
 });
 it('enforces viewer writes, pagination bounds and database tenant foreign keys',async()=>{
  await db.insert(businessMemberships).values({businessId:owner.b,userId:other.id,role:'viewer'});
  expect((await call('GET',`/businesses/${owner.b}/appointments`,undefined,other)).statusCode).toBe(200);expect((await call('POST',`/businesses/${owner.b}/resources`,{displayName:'Viewer attempt'},other)).statusCode).toBe(404);
  expect((await call('GET',`/businesses/${owner.b}/appointments?limit=101`)).statusCode).toBe(400);
  const page=(await call('GET',`/businesses/${owner.b}/customers?limit=1`)).json();expect(page.customers).toHaveLength(1);expect(page.nextCursor).toBeTruthy();const next=(await call('GET',`/businesses/${owner.b}/customers?limit=1&cursor=${page.nextCursor}`)).json();expect(next.customers[0].id).not.toBe(page.customers[0].id);
  await expect(db.execute(sql`insert into service_resources (business_id,service_id,resource_id) values (${other.b},${serviceId},${resourceId})`)).rejects.toMatchObject({cause:{code:'23503'}});
 });
 it('audits owner cutoff overrides while still denying closed hours and customer bypass',async()=>{
  const booking=await book(16);const policy=(await call('GET',`/businesses/${owner.b}/scheduling-policy`)).json().policy;
  expect((await call('PUT',`/businesses/${owner.b}/scheduling-policy`,{revision:policy.revision,slotMinutes:15,noticeMinutes:60,horizonDays:60,cutoffMinutes:10080})).statusCode).toBe(200);
  const payload={kind:'cancel',appointmentId:booking.receipt.recordId,appointmentRevision:1};expect((await call('POST',`/businesses/${owner.b}/action-proposals`,payload)).json().error.code).toBe('POLICY_DENIED');
  const proof=await call('POST',`/public/${owner.slug}/appointment-verifications`,{reference:booking.receipt.bookingRef,token:booking.managementToken},undefined);expect(proof.statusCode).toBe(200);
  const proofData=proof.json();const cookie=proof.cookies[0].name+'='+proof.cookies[0].value;
  const customer=await call('POST',`/public/${owner.slug}/action-proposals`,{handle:proofData.handle,action:{kind:'cancel',appointmentRevision:1}},undefined,crypto.randomUUID(),{cookie,'x-csrf-token':proofData.csrfToken});expect(customer.json().error.code).toBe('POLICY_DENIED');
  const reason='Owner verified customer and agreed to late cancellation';
  expect((await call('POST',`/businesses/${owner.b}/action-proposals`,{kind:'reschedule',appointmentId:booking.receipt.recordId,appointmentRevision:1,resourceId,startsAt:time(18),overrideReason:reason})).json().error.code).toBe('SLOT_UNAVAILABLE');
  const p=await proposal({...payload,overrideReason:reason});expect((await call('POST',`/businesses/${owner.b}/action-proposals/${p.id}/confirm`,{revision:1,confirm:true})).statusCode).toBe(200);
  const audit=await one<{safeMetadata:{overrideReason:string}}>(db,sql`select safe_metadata from audit_events where business_id=${owner.b} and target_id=${booking.receipt.recordId} and operation='cancel'`);expect(audit?.safeMetadata.overrideReason).toBe(reason);
 });
 it('validates hours, notice, horizon, DST and exception precedence',async()=>{
  const policy=(await call('GET',`/businesses/${owner.b}/scheduling-policy`)).json().policy;const path=`/businesses/${owner.b}/hours`;
  for(const intervals of [[{start:'23:00',end:'01:00'}],[{start:'09:00',end:'12:00'},{start:'11:00',end:'13:00'}]])expect((await call('PUT',path,{revision:policy.revision,weekly:[{weekday:1,intervals}],overrides:[]})).statusCode).toBe(400);
  const schedule=await loadSchedule(db,owner.b);expect(()=>slot(schedule,serviceId,resourceId,new Date(Date.now()-60000))).toThrow();expect(()=>slot(schedule,serviceId,resourceId,new Date(time(9,addDays(day,181))))).toThrow();expect(()=>slot(schedule,serviceId,resourceId,new Date(`${day}T17:45:00+05:00`))).toThrow();
  await db.execute(sql`insert into availability_overrides (business_id,local_date,kind) values (${owner.b},${day},'closed')`);
  await expect(db.execute(sql`insert into availability_overrides (business_id,local_date,kind,start,"end") values (${owner.b},${day},'open','09:00','12:00')`)).rejects.toMatchObject({cause:{code:'23514'}});
  await db.execute(sql`delete from availability_overrides where business_id=${owner.b}`);
  schedule.overrides.push({resourceId:null,localDate:day,kind:'closed',start:null,end:null},{resourceId,localDate:day,kind:'open',start:'09:00',end:'18:00'});expect(()=>slot(schedule,serviceId,resourceId,new Date(time(16)))).toThrow();
  expect(localInstants('2026-03-08','02:30','America/New_York')).toHaveLength(0);const repeated=localInstants('2026-11-01','01:30','America/New_York');expect(repeated).toHaveLength(2);expect(+repeated[1]-+repeated[0]).toBe(3600000);
  expect((await call('GET',`/businesses/${owner.b}/availability?serviceId=${serviceId}&from=${day}&to=${addDays(day,7)}`)).statusCode).toBe(400);
 });
 it('returns a structured 503 when PostgreSQL is unavailable',async()=>{
  const unavailable=createDb('postgres://invalid:invalid@127.0.0.1:1/unavailable');const broken=await buildApp(unavailable.db,env);
  const response=await broken.inject({method:'POST',url:'/api/v1/auth/register',headers:origin,payload:{name:'Unavailable',email:'unavailable@example.test',password:'correct horse battery stable 34'}});expect(response.statusCode,response.body).toBe(503);expect(response.json().error.code).toBe('TEMPORARILY_UNAVAILABLE');await broken.close();await unavailable.pool.end();
 });
});
