import {sql} from 'drizzle-orm';
import type {Db} from '../db/client.js';
import {one,required} from '../scheduling/service.js';
import {HttpError} from '../http.js';

export const rates={model:'gpt-realtime-2.1-mini',source:'OpenAI pricing 2026-10-25',text:{input:0.60,cached:0.06,output:2.40},audio:{input:10,cached:0.30,output:20},transcriptionPerMinute:0.0045} as const;
type Details={text_tokens?:number;audio_tokens?:number;cached_tokens?:number;cached_tokens_details?:{text_tokens?:number;audio_tokens?:number}};
export type ResponseUsage={input_tokens:number;output_tokens:number;input_token_details?:Details;output_token_details?:Details};
function count(value:unknown){if(typeof value!=='number'||!Number.isFinite(value)||value<0||!Number.isInteger(value))throw new HttpError(400,'USAGE_INVALID','Provider usage is incomplete or invalid');return value;}
export function responseCost(usage:ResponseUsage){
 const input=usage.input_token_details,output=usage.output_token_details;if(!input||!output)throw new HttpError(400,'USAGE_INVALID','Provider modality usage is missing');
 const it=count(input.text_tokens),ia=count(input.audio_tokens),ot=count(output.text_tokens),oa=count(output.audio_tokens),cached=input.cached_tokens===undefined?0:count(input.cached_tokens),ct=cached?count(input.cached_tokens_details?.text_tokens):0,ca=cached?count(input.cached_tokens_details?.audio_tokens):0;
 if(it+ia!==count(usage.input_tokens)||ot+oa!==count(usage.output_tokens)||ct+ca!==cached||ct>it||ca>ia)throw new HttpError(400,'USAGE_INVALID','Provider usage totals are inconsistent');
 return ((it-ct)*rates.text.input+ct*rates.text.cached+ot*rates.text.output+(ia-ca)*rates.audio.input+ca*rates.audio.cached+oa*rates.audio.output)/1_000_000;
}
export function transcriptionCost(usage:unknown){if(!usage||typeof usage!=='object'||!('type' in usage)||usage.type!=='duration'||!('seconds' in usage)||typeof usage.seconds!=='number'||!Number.isFinite(usage.seconds)||usage.seconds<0)throw new HttpError(400,'USAGE_INVALID','Transcription duration usage is missing');return usage.seconds/60*rates.transcriptionPerMinute;}
export async function persistUsage(db:Db,businessId:string,sessionId:string,source:'response'|'transcription',key:string,usage:unknown,model:string){
 const amount=source==='response'?responseCost(usage as ResponseUsage):transcriptionCost(usage);
 return db.transaction(async tx=>{
  const session=required(await one<{id:string}>(tx,sql`select id from voice_sessions where business_id=${businessId} and id=${sessionId} for update`));void session;
  const inserted=await one<{id:string}>(tx,sql`insert into usage_events (business_id,session_id,source,provider_event_key,model,raw_usage,rate_snapshot,estimated_usd) values (${businessId},${sessionId},${source},${key},${model},${JSON.stringify(usage)}::jsonb,${JSON.stringify(rates)}::jsonb,${amount}) on conflict (session_id,source,provider_event_key) do nothing returning id`);
  if(inserted)await tx.execute(sql`update usage_guard_state set lifetime_observed_usd=lifetime_observed_usd+${amount},updated_at=now() where id=1`);
  return {recorded:!!inserted,estimatedUsd:amount};
 });
}
