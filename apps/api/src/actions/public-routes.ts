import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { inquiryInput, verificationInput, managementProposal, managementConfirm, availabilityInput, uuid } from '@bellntell/contracts';
import type { Db } from '../db/client.js';
import type { Env } from '../env.js';
import { HttpError, parseBody } from '../http.js';
import { requireKey } from '../businesses/routes.js';
import { consumeThrottle, consumeProofThrottle } from '../auth/throttle.js';
import { keyedHash, randomSecret, safeEqual } from '../auth/crypto.js';
import { one, required, loadSchedule, availability, lockPolicy, type Appointment, type Business } from '../scheduling/service.js';
import { safeAppointment } from '../catalog/routes.js';
import { prepare, proposalView, submitInquiry, type Actor, type Proposal } from './service.js';

const COOKIE='bnt_management';
const handleSchema=z.strictObject({businessId:uuid,appointmentId:uuid,session:z.string(),credential:z.string(),expires:z.number()});
type Handle=z.infer<typeof handleSchema>;
export function registerPublicRoutes(app:FastifyInstance,db:Db,env:Env) {
 const base='/api/v1/public/:slug';
 async function business(request:FastifyRequest) {
  const {slug}=parseBody(z.object({slug:z.string().min(1).max(200)}),request.params);
  return required(await one<Business>(db,sql`select id,name,slug,timezone,status from businesses where slug=${slug}`));
 }
 function browserSession(request:FastifyRequest,reply:FastifyReply) {
  const value=request.cookies[COOKIE]??randomSecret();
  reply.setCookie(COOKIE,value,{httpOnly:true,sameSite:'strict',secure:env.NODE_ENV==='production',path:'/',maxAge:600});
  return value;
 }
 function csrf(cookie:string){return keyedHash(env.AUTH_HASH_KEY,'management-csrf',cookie);}
 function encode(value:Handle){const body=Buffer.from(JSON.stringify(value)).toString('base64url');return `${body}.${keyedHash(env.AUTH_HASH_KEY,'management-handle',body)}`;}
 async function proof(request:FastifyRequest,b:string,handle:string) {
  const cookie=request.cookies[COOKIE];const [body,signature,...extra]=handle.split('.');
  const invalid=()=>new HttpError(403,'OWNERSHIP_UNVERIFIED','Verify the booking reference and private token again');
  if(!cookie||!body||!signature||extra.length||!safeEqual(signature,keyedHash(env.AUTH_HASH_KEY,'management-handle',body)))throw invalid();
  let value:Handle;
  try{value=handleSchema.parse(JSON.parse(Buffer.from(body,'base64url').toString()));}catch{throw invalid();}
  if(value.businessId!==b||value.expires<Date.now()||!safeEqual(value.session,keyedHash(env.AUTH_HASH_KEY,'management-session',cookie)))throw invalid();
  const appointment=await one<Appointment>(db,sql`select * from appointments where business_id=${b} and id=${value.appointmentId}`);
  if(!appointment||!safeEqual(value.credential,keyedHash(env.AUTH_HASH_KEY,'management-credential',appointment.manageTokenHash)))throw invalid();
  if(request.method!=='GET') {const header=request.headers['x-csrf-token'];if(typeof header!=='string'||!safeEqual(header,csrf(cookie)))throw new HttpError(403,'CSRF_INVALID','Invalid request token');}
  const actor:Actor={kind:'management',id:keyedHash(env.AUTH_HASH_KEY,'management-actor',`${value.session}:${appointment.id}:${value.credential}`),appointmentId:appointment.id};
  return {actor,appointment};
 }
 function headerHandle(request:FastifyRequest){const handle=request.headers['x-management-handle'];if(typeof handle!=='string'||handle.length>3000)throw new HttpError(403,'OWNERSHIP_UNVERIFIED','Verify this booking first');return handle;}
 function proposalId(request:FastifyRequest){return parseBody(z.object({id:uuid}),request.params).id;}
 app.get(`${base}/receptionist`,async(request,reply)=> {
  const b=await business(request);browserSession(request,reply);
  const facts=await one(db,sql`select public_email,public_phone,public_address,public_website,public_description from business_settings where business_id=${b.id}`);
  return {business:b,facts,voiceAvailable:false,contactConsentVersion:'contact-v1'};
 });
 app.post(`${base}/inquiries`,async request=> {
  const b=await business(request);const input=parseBody(inquiryInput,request.body);const key=requireKey(request);
  if(!await consumeThrottle(db,env.AUTH_HASH_KEY,'public-inquiry',`${b.id}:${request.ip}`,20))throw new HttpError(429,'RATE_LIMITED','Please try again later or contact the business directly');
  return submitInquiry(db,env,b.id,{kind:'form',id:'public-contact'},key,{kind:'inquiry',...input});
 });
 app.post(`${base}/appointment-verifications`,async(request,reply)=> {
  const b=await business(request);const input=parseBody(verificationInput,request.body);const cookie=browserSession(request,reply);
  // Persistent per-reference and per-IP budgets cannot be reset by deleting a browser cookie.
  const allowed=await consumeProofThrottle(db,env.AUTH_HASH_KEY,'management-reference',`${b.id}:${input.reference}`,5);
  const ipAllowed=await consumeProofThrottle(db,env.AUTH_HASH_KEY,'management-ip',`${b.id}:${request.ip}`,30);
  if(!allowed||!ipAllowed)throw new HttpError(429,'RATE_LIMITED','Verification unavailable; try again later or contact the business');
  const appointment=await one<Appointment>(db,sql`select * from appointments where business_id=${b.id} and booking_ref=${input.reference}`);
  const hash=keyedHash(env.AUTH_HASH_KEY,'management',input.token);
  if(!safeEqual(appointment?.manageTokenHash??'0'.repeat(64),hash)||!appointment)throw new HttpError(403,'OWNERSHIP_UNVERIFIED','Verification details were not accepted');
  const handle=encode({businessId:b.id,appointmentId:appointment.id,session:keyedHash(env.AUTH_HASH_KEY,'management-session',cookie),credential:keyedHash(env.AUTH_HASH_KEY,'management-credential',appointment.manageTokenHash),expires:Date.now()+600000});
  return {handle,csrfToken:csrf(cookie),appointment:safeAppointment(appointment)};
 });
 app.get(`${base}/managed-appointment`,async request=>{const b=await business(request);const {appointment}=await proof(request,b.id,headerHandle(request));return {appointment:safeAppointment(appointment)};});
 app.get(`${base}/availability`,async request=>{const b=await business(request);const {appointment}=await proof(request,b.id,headerHandle(request));const input=parseBody(availabilityInput,request.query);if(input.serviceId!==appointment.serviceId)throw new HttpError(403,'OWNERSHIP_UNVERIFIED','Availability is limited to this booking service');const schedule=await loadSchedule(db,b.id);schedule.busy=schedule.busy.filter(x=>x.id!==appointment.id);const service=schedule.services.find(x=>x.id===appointment.serviceId);if(service)service.durationMinutes=appointment.durationMinutes;return {candidates:availability(schedule,input)};});
 app.post(`${base}/action-proposals`,async request=> {
  const b=await business(request);const input=parseBody(managementProposal,request.body);const {actor,appointment}=await proof(request,b.id,input.handle);
  const action={...input.action,appointmentId:appointment.id};
  return {proposal:await proposalView(db,b.id,await prepare(db,env,b.id,actor,requireKey(request),action))};
 });
 app.get(`${base}/action-proposals/:id`,async request=> {
  const b=await business(request);const {actor}=await proof(request,b.id,headerHandle(request));const p=required(await one<Proposal>(db,sql`select * from action_proposals where business_id=${b.id} and id=${proposalId(request)} and actor_kind=${actor.kind} and actor_id=${actor.id}`));return {proposal:await proposalView(db,b.id,p)};
 });
 app.post(`${base}/action-proposals/:id/confirm`,async request=> {
  const b=await business(request);const input=parseBody(managementConfirm,request.body);const {actor}=await proof(request,b.id,input.handle);requireKey(request);
  // Serialize proof revocation versus commit using the scheduling lock, before proposal and appointment locks.
  return db.transaction(async tx=> {const policy=await lockPolicy(tx,b.id);await proof(request,b.id,input.handle);const {confirmTx}=await import('./service.js');return confirmTx(tx,env,b.id,actor,proposalId(request),input.revision,policy);});
 });
 app.post(`${base}/action-proposals/:id/reject`,async request=> {
  const b=await business(request);const input=parseBody(z.strictObject({handle:z.string().max(3000)}),request.body);const {actor}=await proof(request,b.id,input.handle);requireKey(request);
  required(await one(db,sql`update action_proposals set status='rejected',revision=revision+1,payload='{}'::jsonb where business_id=${b.id} and id=${proposalId(request)} and actor_kind=${actor.kind} and actor_id=${actor.id} and status='prepared' returning id`));return {ok:true};
 });
}
