import {createHash} from 'node:crypto';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import {sql} from 'drizzle-orm';
import {z} from 'zod';
import {conversationConfig,snapshotInput,sessionInput,simulatorTurn,verificationInput,uuid} from '@bellntell/contracts';
import type {Db} from '../db/client.js';
import type {Env} from '../env.js';
import {authContext,requireCsrf} from '../auth/routes.js';
import {keyedHash,safeEqual} from '../auth/crypto.js';
import {authorize,requireKey} from '../businesses/routes.js';
import {HttpError,parseBody} from '../http.js';
import {one,required,loadSchedule} from '../scheduling/service.js';
import {ensureDraft,saveDraft,snapshot,loadVersion} from './configuration.js';
import {validateConfig} from './validator.js';
import {configOf,type Session} from './contracts.js';
import {createSession,processTurn,projection,browserConfirm,rejectProposal,verifyAppointment,endSession,events} from './controller.js';
const exactConfirm=z.strictObject({revision:z.int().positive(),stateRevision:z.int().positive(),confirm:z.literal(true)});
const exactReject=z.strictObject({revision:z.int().positive(),stateRevision:z.int().positive()});
function routeId(request:FastifyRequest){return parseBody(z.object({id:uuid}),request.params).id;}
function stableUuid(value:string){const bytes=createHash('sha256').update(value).digest();bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;const hex=bytes.subarray(0,16).toString('hex');return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;}
export function registerConversationRoutes(app:FastifyInstance,db:Db,env:Env){
 const base='/api/v1/businesses/:b/receptionist';
 app.get(base+'/draft',async request=>{const {auth,businessId:b}=await authorize(request,db,env,'viewer');return {draft:await ensureDraft(db,b,auth.user.id)};});
 app.put(base+'/draft',async request=>{const {auth,businessId:b}=await authorize(request,db,env,'manager');requireCsrf(request,env,auth);const match=request.headers['if-match'];if(typeof match!=='string'||!/^"?[1-9]\d*"?$/.test(match))throw new HttpError(400,'VALIDATION_ERROR','If-Match draft revision is required');return saveDraft(db,env,b,{kind:'owner',id:auth.user.id},requireKey(request),Number(match.replaceAll('"','')),parseBody(conversationConfig,request.body));});
 app.post(base+'/validate',async request=>{const {auth,businessId:b}=await authorize(request,db,env,'manager');requireCsrf(request,env,auth);const input=parseBody(snapshotInput,request.body);const current=await ensureDraft(db,b,auth.user.id);if(current.id!==input.draftId||current.draftRevision!==input.revision)throw new HttpError(409,'REVISION_CONFLICT','Draft changed; reload before validating');const issues=validateConfig(configOf(current),await loadSchedule(db,b));return {valid:issues.length===0,issues};});
 app.post(base+'/test-snapshots',async request=>{const {auth,businessId:b}=await authorize(request,db,env,'manager');requireCsrf(request,env,auth);const input=parseBody(snapshotInput,request.body);return snapshot(db,env,b,{kind:'owner',id:auth.user.id},requireKey(request),input.draftId,input.revision);});
 async function sessionAccess(request:FastifyRequest){
  const auth=await authContext(request,db,env);const id=routeId(request);const s=await one<Session>(db,sql`select s.* from voice_sessions s join business_memberships m on m.business_id=s.business_id and m.user_id=${auth.user.id} and m.status='active' and m.role in ('owner','manager') where s.id=${id} and s.created_by=${auth.user.id}`);if(!s)throw new HttpError(404,'NOT_FOUND','Conversation not found');
  const capability=request.headers['x-session-capability'];if(typeof capability!=='string'||capability.length>128||!safeEqual(s.capabilityHash,keyedHash(env.AUTH_HASH_KEY,'conversation-capability',capability)))throw new HttpError(403,'SESSION_CAPABILITY_INVALID','This conversation capability was not accepted');
  if(s.closedAt&&Date.now()-+s.closedAt>600000)throw new HttpError(410,'SESSION_EXPIRED','Receipt retrieval period has ended');
  if(request.method!=='GET'){requireCsrf(request,env,auth);requireKey(request);}return s;
 }
 for(const path of ['/api/v1/simulations','/api/v1/voice-sessions'])app.post(path,async request=>{
  const input=parseBody(sessionInput,request.body);if(path.endsWith('simulations')&&input.mode!=='preview')throw new HttpError(400,'VALIDATION_ERROR','Simulations must use preview mode');
  const auth=await authContext(request,db,env);requireCsrf(request,env,auth);const membership=await one(db,sql`select business_id from business_memberships where business_id=${input.businessId} and user_id=${auth.user.id} and status='active' and role in ('owner','manager')`);required(membership);return createSession(db,env,input.businessId,auth.user.id,input.testSnapshotId,input.mode,input.acknowledgeRealActions,requireKey(request));
 });
 for(const prefix of ['/api/v1/simulations/:id','/api/v1/voice-sessions/:id']){
  app.get(prefix,async request=>{const s=await sessionAccess(request);const v=await loadVersion(db,s.businessId,s.configVersionId);const schedule=s.mode==='preview'?v.testFixture!.schedule:await loadSchedule(db,s.businessId);return {session:projection(s,v),catalog:{services:schedule.services.filter(x=>x.active),resources:schedule.resources.filter(x=>x.active)}};});
  app.post(prefix+'/turns',async request=>{const s=await sessionAccess(request);const input=parseBody(simulatorTurn,request.body);const key=requireKey(request);return processTurn(db,env,s.businessId,{event_id:stableUuid(`${s.id}:event:${key}`),session_id:s.id,input_turn_id:stableUuid(`${s.id}:input:${key}`),expected_state_revision:input.expectedStateRevision,provider_response_id:`simulator:${key}`,provider_function_call_id:`simulator:${key}`},input.text,input.interpretation);});
  app.get(prefix+'/events',async request=>{const s=await sessionAccess(request);const input=parseBody(z.strictObject({after:z.coerce.number().int().min(0).default(0)}),request.query);if(s.status==='closed')return {events:s.engineState.receipts.map(receipt=>({type:'receipt',receipt}))};return {events:await events(db,s.businessId,s.id,input.after)};});
  app.post(prefix+'/proposals/:proposalId/confirm',async request=>{const s=await sessionAccess(request);const {proposalId}=parseBody(z.object({proposalId:uuid}),request.params);const input=parseBody(exactConfirm,request.body);return browserConfirm(db,env,s.businessId,s.id,proposalId,input.revision,input.stateRevision);});
  app.post(prefix+'/proposals/:proposalId/reject',async request=>{const s=await sessionAccess(request);const {proposalId}=parseBody(z.object({proposalId:uuid}),request.params);const input=parseBody(exactReject,request.body);return rejectProposal(db,env,s.businessId,s.id,proposalId,input.revision,input.stateRevision);});
  app.post(prefix+'/appointment-verifications',async request=>{const s=await sessionAccess(request);const input=parseBody(verificationInput,request.body);return verifyAppointment(db,env,s.businessId,s.id,input.reference,input.token,request.ip);});
  app.post(prefix+'/end',async request=>{const s=await sessionAccess(request);parseBody(z.strictObject({}),request.body);return endSession(db,env,s.businessId,s.id);});
  app.post(prefix+'/restarts',async request=>{const s=await sessionAccess(request);parseBody(z.strictObject({}),request.body);await endSession(db,env,s.businessId,s.id);const created=await createSession(db,env,s.businessId,s.createdBy,s.configVersionId,s.mode,true,`restart:${s.id}:${requireKey(request)}`);await db.execute(sql`update voice_sessions set restart_of_session_id=${s.id} where business_id=${s.businessId} and id=${created.session.id}`);return created;});
 }
}
