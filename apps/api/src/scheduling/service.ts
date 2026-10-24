import { sql, type SQL } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { HttpError } from '../http.js';

export type Executor = Pick<Db, 'execute'>;
export type Policy = { businessId:string; revision:number; slotMinutes:number; noticeMinutes:number; horizonDays:number; cutoffMinutes:number };
export type Business = {id:string;name:string;slug:string;timezone:string;status:string};
export type Service = {id:string;businessId:string;revision:number;name:string;durationMinutes:number;publicDescription:string;priceText:string;active:boolean};
export type Resource = {id:string;businessId:string;revision:number;displayName:string;active:boolean};
export type Appointment = {id:string;businessId:string;revision:number;customerId:string;serviceId:string;resourceId:string;startsAt:Date;endsAt:Date;timezone:string;serviceName:string;durationMinutes:number;priceText:string;status:string;source:string;bookingRef:string;manageTokenHash:string};
export async function rows<T>(db:Executor, query:SQL):Promise<T[]> {
 const result = await db.execute(query);
 // Drizzle's raw execute path leaves PostgreSQL timestamps as strings.
 return result.rows.map(row => Object.fromEntries(Object.entries(row).map(([k,v])=>[k.replace(/_([a-z])/g,(_,c:string)=>c.toUpperCase()),k.endsWith('_at')&&typeof v==='string'?new Date(v):v]))) as T[];
}
export async function one<T>(db:Executor, query:SQL):Promise<T|undefined> { return (await rows<T>(db,query))[0]; }
export function required<T>(value:T|undefined):T { if(!value) throw new HttpError(404,'NOT_FOUND','Record not found'); return value; }
export async function lockPolicy(db:Executor,b:string) {
 await db.execute(sql`insert into scheduling_policies (business_id) values (${b}) on conflict do nothing`);
 return required(await one<Policy>(db,sql`select * from scheduling_policies where business_id=${b} for update`));
}
export async function bumpPolicy(db:Executor,b:string) { await db.execute(sql`update scheduling_policies set revision=revision+1 where business_id=${b}`); }
export async function audit(db:Executor,b:string,actorKind:string,actorId:string,operation:string,targetType:string,targetId:string|null,metadata:Record<string,unknown>={}) {
 await db.execute(sql`insert into audit_events (business_id,actor_kind,actor_id,operation,target_type,target_id,safe_metadata,outcome) values (${b},${actorKind},${actorId},${operation},${targetType},${targetId},${JSON.stringify(metadata)}::jsonb,'ok')`);
}
type Interval = {start:string;end:string};
type Hour = Interval & {weekday:number};
type Override = {resourceId:string|null;localDate:string;kind:string;start:string|null;end:string|null};
type Busy = {id:string;resourceId:string;startsAt:Date;endsAt:Date};
export type Schedule = {business:Business;policy:Policy;services:Service[];resources:Resource[];eligible:{serviceId:string;resourceId:string}[];hours:Hour[];overrides:Override[];busy:Busy[]};
export async function loadSchedule(db:Executor,b:string):Promise<Schedule> {
 // Sequential inside a transaction: one connection, one coherent locked schedule.
 const business = required(await one<Business>(db,sql`select id,name,slug,timezone,status from businesses where id=${b}`));
 const policy = required(await one<Policy>(db,sql`select * from scheduling_policies where business_id=${b}`));
 const services = await rows<Service>(db,sql`select * from services where business_id=${b}`);
 const resources = await rows<Resource>(db,sql`select * from resources where business_id=${b}`);
 const eligible = await rows<{serviceId:string;resourceId:string}>(db,sql`select service_id,resource_id from service_resources where business_id=${b}`);
 const hours = await rows<Hour>(db,sql`select weekday,start::text,"end"::text from business_hours where business_id=${b}`);
 const overrides = await rows<Override>(db,sql`select resource_id,local_date::text,kind,start::text,"end"::text from availability_overrides where business_id=${b}`);
 const busy = await rows<Busy>(db,sql`select id,resource_id,starts_at,ends_at from appointments where business_id=${b} and status='confirmed'`);
 return {business,policy,services,resources,eligible,hours,overrides,busy};
}
const formats = new Map<string,Intl.DateTimeFormat>();
export function localParts(instant:Date,timezone:string) {
 let format = formats.get(timezone);
 if(!format) { format = new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}); formats.set(timezone,format); }
 const p = Object.fromEntries(format.formatToParts(instant).map(x=>[x.type,x.value]));
 return {date:`${p.year}-${p.month}-${p.day}`,time:`${p.hour}:${p.minute}`,second:p.second};
}
export function addDays(date:string,days:number) { return new Date(Date.parse(date+'T12:00:00Z')+days*86400000).toISOString().slice(0,10); }
export function localInstants(date:string,time:string,timezone:string):Date[] {
 const baseline = Date.parse(`${date}T${time}:00Z`); const offsets = new Set<number>();
 for(let delta=-36;delta<=36;delta+=6) {
  const probe = new Date(baseline+delta*3600000); const p = localParts(probe,timezone);
  offsets.add(Date.parse(`${p.date}T${p.time}:${p.second}Z`)-probe.getTime());
 }
 return [...offsets].map(offset=>new Date(baseline-offset)).filter(d=> {const p=localParts(d,timezone);return p.date===date&&p.time===time;}).sort((a,b)=>+a-+b);
}
function intervals(schedule:Schedule,date:string,resourceId:string):Interval[] {
 const weekday = new Date(date+'T12:00:00Z').getUTCDay();
 const business = schedule.overrides.filter(x=>x.localDate===date&&x.resourceId===null);
 let base:Interval[] = business.length ? business.filter(x=>x.kind==='open').map(x=>({start:x.start!,end:x.end!})) : schedule.hours.filter(x=>x.weekday===weekday);
 const resource = schedule.overrides.filter(x=>x.localDate===date&&x.resourceId===resourceId);
 if(resource.length) {
  const open = resource.filter(x=>x.kind==='open');
  base = base.flatMap(a=>open.map(b=>({start:a.start>b.start! ? a.start:b.start!,end:a.end<b.end! ? a.end:b.end!})).filter(x=>x.start<x.end));
 }
 return base;
}
export function slot(schedule:Schedule,serviceId:string,resourceId:string,start:Date,now=new Date(),excludeId?:string,durationOverride?:number) {
 const service = schedule.services.find(x=>x.id===serviceId&&x.active);
 const resource = schedule.resources.find(x=>x.id===resourceId&&x.active);
 if(!service||!resource||!schedule.eligible.some(x=>x.serviceId===serviceId&&x.resourceId===resourceId)) throw new HttpError(409,'POLICY_DENIED','Select an active service and eligible resource');
 const duration = durationOverride ?? service.durationMinutes;
 const end = new Date(+start+duration*60000); const p=localParts(start,schedule.business.timezone);
 const minute=Number(p.time.slice(0,2))*60+Number(p.time.slice(3));
 if(start.getUTCMilliseconds()!==0||p.second!=='00'||minute%schedule.policy.slotMinutes!==0||+start<+now+schedule.policy.noticeMinutes*60000||p.date>addDays(localParts(now,schedule.business.timezone).date,schedule.policy.horizonDays)) throw new HttpError(409,'POLICY_DENIED','Time is outside the slot grid, booking notice or horizon');
 for(let at=+start;at<+end;at+=60000) {
  const point=localParts(new Date(at),schedule.business.timezone);
  if(!intervals(schedule,point.date,resourceId).some(x=>point.time>=x.start.slice(0,5)&&point.time<x.end.slice(0,5))) throw new HttpError(409,'SLOT_UNAVAILABLE','The full appointment must fit within open hours');
 }
 if(schedule.busy.some(x=>x.id!==excludeId&&x.resourceId===resourceId&&+x.startsAt<+end&&+x.endsAt>+start)) throw new HttpError(409,'SLOT_UNAVAILABLE','That time is no longer available');
 return {service,resource,end};
}
export function displayTime(start:Date,end:Date,timezone:string) {
 const format = new Intl.DateTimeFormat('en-GB',{timeZone:timezone,dateStyle:'full',timeStyle:'long'});
 return `${format.format(start)} – ${format.format(end)} (${timezone})`;
}
export function availability(schedule:Schedule,input:{serviceId:string;resourceId?:string;from:string;to:string},now=new Date()) {
 const candidates:{serviceId:string;resourceId:string;startsAt:string;endsAt:string;readback:string}[]=[];
 for(let date=input.from;date<=input.to;date=addDays(date,1)) for(let minute=0;minute<1440;minute+=schedule.policy.slotMinutes) {
  const time=`${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`;
  for(const start of localInstants(date,time,schedule.business.timezone)) for(const resource of schedule.resources.filter(x=>!input.resourceId||x.id===input.resourceId)) {
   try {const {end}=slot(schedule,input.serviceId,resource.id,start,now);candidates.push({serviceId:input.serviceId,resourceId:resource.id,startsAt:start.toISOString(),endsAt:end.toISOString(),readback:displayTime(start,end,schedule.business.timezone)});if(candidates.length===3)return candidates;}
   catch(error) {if(!(error instanceof HttpError))throw error;}
  }
 }
 return candidates;
}
