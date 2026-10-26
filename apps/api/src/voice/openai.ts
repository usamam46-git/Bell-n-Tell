import WebSocket from 'ws';
import type {Env} from '../env.js';
import {HttpError} from '../http.js';

const endpoint='https://api.openai.com/v1/realtime/calls';
export type ProviderCall={callId:string;answerSdp:string};
export type Sideband={send:(event:unknown)=>void;close:()=>void;onEvent:(handler:(event:unknown)=>void)=>void;onClose:(handler:()=>void)=>void};
export interface RealtimeProvider{
 createCall(offerSdp:string,safetyId:string):Promise<ProviderCall>;
 attach(callId:string):Promise<Sideband>;
 hangup(callId:string):Promise<void>;
}
export function callIdFromLocation(location:string|null){
 const match=location?.match(/(?:^|\/)v1\/realtime\/calls\/(rtc_[A-Za-z0-9_-]+)$/);
 if(!match)throw new HttpError(502,'PROVIDER_SETUP_UNKNOWN','Provider did not return a usable call ID');
 return match[1];
}
export class OpenAIRealtimeProvider implements RealtimeProvider{
 constructor(private env:Env,private request:typeof fetch=fetch){}
 private key(){if(!this.env.OPENAI_API_KEY)throw new HttpError(503,'LIVE_AI_DISABLED','Provider credential is unavailable');return this.env.OPENAI_API_KEY;}
 async createCall(offerSdp:string,safetyId:string):Promise<ProviderCall>{
  if(!this.env.LIVE_AI_ENABLED)throw new HttpError(503,'LIVE_AI_DISABLED','Live AI is not enabled');
  const data=new FormData();data.set('sdp',offerSdp);data.set('session',JSON.stringify({type:'realtime',model:this.env.OPENAI_REALTIME_MODEL,audio:{output:{voice:'marin'},input:{transcription:{model:'gpt-transcribe'},turn_detection:{type:'server_vad',create_response:false,interrupt_response:true}}},tools:[],tool_choice:'none',max_output_tokens:1024}));
  let response:Response;
  try{response=await this.request(endpoint,{method:'POST',headers:{Authorization:`Bearer ${this.key()}`,'OpenAI-Safety-Identifier':safetyId},body:data,signal:AbortSignal.timeout(15000)});}catch{throw new HttpError(503,'PROVIDER_SETUP_UNKNOWN','Provider setup did not return a confirmed result');}
  if(!response.ok)throw new HttpError(503,'PROVIDER_UNAVAILABLE',`Provider rejected call setup (${response.status})`);
  const callId=callIdFromLocation(response.headers.get('location'));const answerSdp=await response.text();if(!answerSdp.startsWith('v=0'))throw new HttpError(502,'PROVIDER_SETUP_UNKNOWN','Provider returned an invalid SDP answer');return {callId,answerSdp};
 }
 async attach(callId:string):Promise<Sideband>{
  if(!this.env.LIVE_AI_ENABLED)throw new HttpError(503,'LIVE_AI_DISABLED','Live AI is not enabled');
  if(!/^rtc_[A-Za-z0-9_-]+$/.test(callId))throw new HttpError(400,'VALIDATION_ERROR','Invalid provider call ID');
  const socket=new WebSocket(`wss://api.openai.com/v1/realtime?call_id=${encodeURIComponent(callId)}`,{headers:{Authorization:`Bearer ${this.key()}`},handshakeTimeout:10000});
  await new Promise<void>((resolve,reject)=>{socket.once('open',resolve);socket.once('error',()=>reject(new HttpError(503,'SIDEBAND_UNAVAILABLE','Provider control channel could not connect')));});
  return {send:event=>{if(socket.readyState!==WebSocket.OPEN)throw new HttpError(503,'SIDEBAND_UNAVAILABLE','Provider control channel closed');socket.send(JSON.stringify(event));},close:()=>socket.close(),onEvent:handler=>socket.on('message',data=>{try{handler(JSON.parse(data.toString()));}catch{/* malformed provider frames cannot authorize actions */}}),onClose:handler=>socket.on('close',handler)};
 }
 async hangup(callId:string):Promise<void>{
  if(!/^rtc_[A-Za-z0-9_-]+$/.test(callId))throw new HttpError(400,'VALIDATION_ERROR','Invalid provider call ID');
  let response:Response;try{response=await this.request(`${endpoint}/${encodeURIComponent(callId)}/hangup`,{method:'POST',headers:{Authorization:`Bearer ${this.key()}`},signal:AbortSignal.timeout(10000)});}catch{throw new HttpError(503,'TERMINATION_UNKNOWN','Provider hangup was not confirmed');}
  if(!response.ok&&response.status!==404&&response.status!==410)throw new HttpError(503,'TERMINATION_UNKNOWN',`Provider hangup was not confirmed (${response.status})`);
 }
}
