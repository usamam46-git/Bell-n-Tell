'use client';
import {useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';

type Pending={id:string;revision:number;stateRevision:number;readback:string};
type LiveSession={id:string;stateRevision:number;directive:string;pending:Pending|null;receipts:{actionReceiptId:string;label:string;kind:string}[];status:string};
type Reply={session:LiveSession;capability:string};
export function VoiceCheckpoint({businessId,snapshotId,csrf}:{businessId:string;snapshotId:string|null;csrf:string}){
 const [consent,setConsent]=useState(false),[ack,setAck]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState('Idle'),[live,setLive]=useState<LiveSession|null>(null);
 const cap=useRef(''),pc=useRef<RTCPeerConnection|null>(null),media=useRef<MediaStream|null>(null),poll=useRef<ReturnType<typeof setInterval>|null>(null);
 async function api<T>(path:string,method='GET',body?:unknown):Promise<T>{
  let response:Response;try{response=await fetch(`/api/v1${path}`,{method,credentials:'same-origin',cache:'no-store',headers:{...(body?{'content-type':'application/json'}:{}),...(method!=='GET'?{'x-csrf-token':csrf,'idempotency-key':crypto.randomUUID()}:{}),...(cap.current?{'x-session-capability':cap.current}:{})},body:body?JSON.stringify(body):undefined});}catch{throw Error('The API is unavailable. The server will close an admitted call through its watchdog.');}
  if(!response.headers.get('content-type')?.includes('application/json'))throw Error('The API returned an unreadable response.');
  const data=await response.json() as T&{error?:{message?:string}};if(!response.ok)throw Error(data.error?.message??`Request failed (${response.status})`);return data;
 }
 function cleanup(){if(poll.current){clearInterval(poll.current);poll.current=null;}pc.current?.close();pc.current=null;media.current?.getTracks().forEach(t=>t.stop());media.current=null;}
 useEffect(()=>()=>cleanup(),[]);
 async function refresh(id:string){const state=await api<{session:LiveSession}>(`/voice-sessions/${id}`);setLive(state.session);if(state.session.status==='closed'||state.session.status==='termination_unknown'){cleanup();setStatus(state.session.status);}}
 async function start(){if(!snapshotId||!consent||!ack)return;setBusy(true);setError('');let admitted:Reply|null=null;
  try{
   admitted=await api<Reply>('/voice-sessions','POST',{businessId,testSnapshotId:snapshotId,mode:'real_test',transport:'realtime',acknowledgeRealActions:true,consentVersion:'owner-voice-test-v1'});
   cap.current=admitted.capability;setLive(admitted.session);setStatus('Admission reserved. Connecting microphone.');
   media.current=await navigator.mediaDevices.getUserMedia({audio:true});const peer=new RTCPeerConnection();pc.current=peer;
   const audio=document.createElement('audio');audio.autoplay=true;peer.ontrack=e=>{audio.srcObject=e.streams[0];};media.current.getTracks().forEach(track=>peer.addTrack(track,media.current!));
   const data=peer.createDataChannel('oai-events');data.onmessage=e=>{try{const item=JSON.parse(e.data) as {type?:string};if(item.type==='output_audio_buffer.stopped')setStatus('Listening for your next turn.');}catch{}};
   const offer=await peer.createOffer();await peer.setLocalDescription(offer);await new Promise<void>((resolve,reject)=>{if(peer.iceGatheringState==='complete')return resolve();const timeout=setTimeout(()=>reject(Error('Microphone network setup timed out')),10000);peer.addEventListener('icegatheringstatechange',()=>{if(peer.iceGatheringState==='complete'){clearTimeout(timeout);resolve();}});});
   const answer=await api<{answerSdp:string}>(`/voice-sessions/${admitted.session.id}/offer`,'POST',{sdp:peer.localDescription?.sdp});await peer.setRemoteDescription({type:'answer',sdp:answer.answerSdp});
   await new Promise<void>((resolve,reject)=>{if(peer.connectionState==='connected')return resolve();const timeout=setTimeout(()=>{peer.removeEventListener('connectionstatechange',changed);reject(Error('Microphone connection did not become ready'));},8000);const changed=()=>{if(peer.connectionState==='connected'){clearTimeout(timeout);peer.removeEventListener('connectionstatechange',changed);resolve();}else if(peer.connectionState==='failed'||peer.connectionState==='closed'){clearTimeout(timeout);peer.removeEventListener('connectionstatechange',changed);reject(Error('Microphone connection failed'));}};peer.addEventListener('connectionstatechange',changed);});
   setStatus('Live owner test. The server controls all actions and call limits.');
   poll.current=setInterval(()=>{void (async()=>{if(!admitted)return;try{await api(`/voice-sessions/${admitted.session.id}/heartbeat`,'POST',{});await refresh(admitted.session.id);}catch(e){setError((e as Error).message);cleanup();}})();},5000);
  }catch(e){setError((e as Error).message);cleanup();if(admitted){try{await api(`/voice-sessions/${admitted.session.id}/end`,'POST',{});}catch{setStatus('Termination not confirmed. No new call will be admitted until reconciliation.');}}}
  finally{setBusy(false);}
 }
 async function stop(){if(!live)return;setBusy(true);setError('');try{await api(`/voice-sessions/${live.id}/end`,'POST',{});setStatus('Call closed by the server.');await refresh(live.id);}catch(e){setError((e as Error).message);setStatus('Server hangup is unconfirmed.');}finally{cleanup();setBusy(false);}}
 async function confirm(){if(!live?.pending)return;setBusy(true);setError('');const p=live.pending;try{const result=await api<{session:LiveSession}>(`/voice-sessions/${live.id}/proposals/${p.id}/confirm`,'POST',{revision:p.revision,stateRevision:p.stateRevision,confirm:true});setLive(result.session);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <section className="mt-6 rounded border border-amber-300 bg-amber-50 p-4" aria-label="Live voice feasibility test"><h3 className="font-semibold">Live voice feasibility test</h3><p className="mt-1 text-sm">Owner only. This test can create a real appointment and use paid AI. The server limits this follow-up call to 90 seconds and reserves budget before microphone access.</p>
  <label className="mt-3 flex gap-2 text-sm"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>I agree to AI audio processing and application storage of finalized transcripts. The application does not store raw audio.</label>
  <label className="mt-2 flex gap-2 text-sm"><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/>I understand a confirmed action changes the real test business schedule.</label>
  <div className="mt-3 flex gap-2"><Button type="button" disabled={!snapshotId||!consent||!ack||busy||!!live} onClick={start}>Start bounded voice test</Button><Button type="button" variant="outline" disabled={!live||busy} onClick={stop}>End call on server</Button></div>
  <p role="status" className="mt-3 text-sm">{status}</p>{error&&<p role="alert" className="mt-2 text-sm text-red-800">{error}</p>}{live&&<div className="mt-3 text-sm"><p>{live.directive}</p>{live.pending&&<div className="mt-3 rounded border bg-white p-3"><p className="font-semibold">Review real action before browser confirmation</p><p>{live.pending.readback}</p><Button className="mt-2" type="button" disabled={busy} onClick={confirm}>Confirm exact real action</Button></div>}{live.receipts.map(r=><p key={r.actionReceiptId} className="mt-2 font-medium">{r.label} · {r.kind}</p>)}</div>}
 </section>;
}
