import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Pool} from 'pg';

test.skip(process.env.LIVE_BOOKING_SMOKE!=='1','Explicit paid Phase 3V spoken booking only');
test.use({permissions:['microphone'],launchOptions:{args:['--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required']}});
test.setTimeout(100000);

function speech(text:string){
 const dir=mkdtempSync(join(tmpdir(),'bellntell-voice-'));
 try{const aiff=join(dir,'speech.aiff'),wav=join(dir,'speech.wav');execFileSync('say',['-r','210','-o',aiff,text]);execFileSync('ffmpeg',['-y','-loglevel','error','-i',aiff,'-ac','1','-ar','48000',wav]);return readFileSync(wav).toString('base64');}
 finally{rmSync(dir,{recursive:true,force:true});}
}

test('spoken booking commits only after completed read-back and exact affirmation',async({page})=>{
 const database=new Pool({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:3000});
 const nonce=crypto.randomUUID(),slug=`voice-booking-${nonce}`;
 let sessionId:string|undefined;
 await page.addInitScript(()=>{
  const context=new AudioContext(),destination=context.createMediaStreamDestination();
  // Keep RTP audio flowing between spoken clips so server VAD can observe quiet input.
  const ambience=context.createBuffer(1,context.sampleRate,context.sampleRate),samples=ambience.getChannelData(0);for(let i=0;i<samples.length;i++)samples[i]=(Math.random()*2-1)*0.002;
  const quiet=context.createBufferSource();quiet.buffer=ambience;quiet.loop=true;quiet.connect(destination);quiet.start();
  const diagnostics=window as Window&{voiceTestPeer?:RTCPeerConnection;voiceTestEvents?:string[];voiceTestResponses?:{type:string;purpose:string|null;status:string|null;outputTypes:string[];argumentLength:number|null}[]};diagnostics.voiceTestEvents=[];diagnostics.voiceTestResponses=[];
  const originalSetRemote=RTCPeerConnection.prototype.setRemoteDescription;
  Object.defineProperty(RTCPeerConnection.prototype,'setRemoteDescription',{value:function(this:RTCPeerConnection,description:RTCSessionDescriptionInit){diagnostics.voiceTestPeer=this;return (originalSetRemote as (this:RTCPeerConnection,value:RTCSessionDescriptionInit)=>Promise<void>).call(this,description);}});
  const originalChannel=RTCPeerConnection.prototype.createDataChannel;
  RTCPeerConnection.prototype.createDataChannel=function(...args){const channel=originalChannel.apply(this,args);channel.addEventListener('message',event=>{try{const value=JSON.parse(event.data) as {type?:string;response?:{metadata?:{response_purpose?:string};status?:string;output?:{type?:string}[]};item?:{type?:string;arguments?:string}};if(value.type)diagnostics.voiceTestEvents?.push(value.type);if(value.type==='response.created'||value.type==='response.done'||value.type==='response.output_item.done')diagnostics.voiceTestResponses?.push({type:value.type,purpose:value.response?.metadata?.response_purpose??null,status:value.response?.status??null,outputTypes:value.response?.output?.map(item=>item.type??'unknown')??(value.item?[value.item.type??'unknown']:[]),argumentLength:typeof value.item?.arguments==='string'?value.item.arguments.length:null});}catch{}});return channel;};
  Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async()=>destination.stream});
  (window as Window&{playVoiceFixture?:(base64:string)=>Promise<void>}).playVoiceFixture=async base64=>{
   await context.resume();const raw=Uint8Array.from(atob(base64),character=>character.charCodeAt(0));const audio=await context.decodeAudioData(raw.buffer);const source=context.createBufferSource();source.buffer=audio;source.connect(destination);await new Promise<void>(resolve=>{source.onended=()=>resolve();source.start();});source.disconnect();
  };
 });
 const play=async(text:string)=>page.evaluate(async base64=>{const fixture=(window as Window&{playVoiceFixture?:(value:string)=>Promise<void>}).playVoiceFixture;if(!fixture)throw Error('Test audio track was not installed');await fixture(base64);},speech(text));
 const state=async()=>{const result=await database.query('select status,state_revision,engine_state from voice_sessions where id=$1',[sessionId]);return result.rows[0] as {status:string;state_revision:number;engine_state:{directive:string;pending:{voiceEligible:boolean}|null;slots:Record<string,string>;candidates:unknown[];receipts:unknown[]}}|undefined;};
 try{
  await page.goto('/');await page.getByRole('button',{name:'Create account',exact:true}).click();await page.getByLabel('Your name').fill('Voice Booking Owner');await page.getByLabel('Email',{exact:true}).fill(`voice-booking-${nonce}@example.test`);await page.getByLabel('Password',{exact:true}).fill('correct horse battery stable 34');await page.getByRole('button',{name:'Create account',exact:true}).last().click();await page.getByLabel('I saved this code in a safe place').check();await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByLabel('Business name',{exact:true}).fill('Voice Booking Business');await page.getByLabel('Public slug').fill(slug);await page.getByLabel('IANA timezone').fill('Asia/Karachi');await page.getByRole('button',{name:'Create business',exact:true}).click();
  const operations=page.getByRole('region',{name:'Business operations'});await operations.getByLabel('Resource name',{exact:true}).fill('Voice Consultant');await operations.getByRole('button',{name:'Save resource',exact:true}).click();await expect(operations.getByRole('status')).toContainText('Resource saved');await operations.getByLabel('Service name',{exact:true}).fill('Voice Consultation');await operations.getByLabel('Price description').fill('PKR 1000');await operations.getByLabel('Voice Consultant',{exact:true}).check();await operations.getByRole('button',{name:'Save service',exact:true}).click();await expect(operations.getByRole('status')).toContainText('Service saved');await operations.getByRole('button',{name:'Hours & policy',exact:true}).click();for(const day of ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'])await operations.getByLabel(`${day} hours`,{exact:true}).fill('09:00-17:00');await operations.getByRole('button',{name:'Save hours',exact:true}).click();
  const preview=page.getByRole('region',{name:'Receptionist text preview'});await preview.getByRole('button',{name:'Load draft'}).click();await preview.getByRole('button',{name:'Start snapshot preview'}).click();await expect(preview.getByText('Simulation started. No real appointment will be created.')).toBeVisible();
  const live=preview.getByRole('region',{name:'Live voice feasibility test'});await live.getByLabel('I agree to AI audio processing and application storage of finalized transcripts. The application does not store raw audio.').check();await live.getByLabel('I understand a confirmed action changes the real test business schedule.').check();await live.getByRole('button',{name:'Start bounded voice test'}).click();await expect(live.getByRole('status')).toContainText('Live owner test',{timeout:30000});
  await page.waitForFunction(()=>((window as Window&{voiceTestPeer?:RTCPeerConnection}).voiceTestPeer?.connectionState==='connected'),undefined,{timeout:10000});
  await page.waitForFunction(()=>(window as Window&{voiceTestEvents?:string[]}).voiceTestEvents?.includes('output_audio_buffer.stopped'),undefined,{timeout:10000});
  const initial=await database.query('select s.id from voice_sessions s join businesses b on b.id=s.business_id where b.slug=$1 and s.transport=$2',[slug,'realtime']);sessionId=initial.rows[0]?.id;expect(sessionId).toBeTruthy();
  const date=new Date(Date.now()+5*86400000);const spokenDate=new Intl.DateTimeFormat('en-US',{month:'long',day:'numeric',year:'numeric',timeZone:'Asia/Karachi'}).format(date);
  await play(`I want to book a Voice Consultation with Voice Consultant on ${spokenDate} at eleven A M.`);
  const outbound=async()=>page.evaluate(async()=>{const peer=(window as Window&{voiceTestPeer?:RTCPeerConnection}).voiceTestPeer;if(!peer)throw Error('Test peer connection is unavailable');const stats=await peer.getStats();let packets=0;stats.forEach(x=>{if(x.type==='outbound-rtp'&&x.kind==='audio')packets+=x.packetsSent??0;});return packets;});
  const sent=await outbound();expect(sent).toBeGreaterThan(0);await page.waitForTimeout(1200);expect(await outbound()).toBeGreaterThan(sent+5);
  try{await expect.poll(async()=>((await state())?.state_revision??1),{timeout:15000}).toBeGreaterThan(1);}
  catch(error){const diagnostics=await page.evaluate(async()=>{const test=window as Window&{voiceTestPeer?:RTCPeerConnection;voiceTestEvents?:string[];voiceTestResponses?:unknown[]};const stats=await test.voiceTestPeer?.getStats(),media:{packetsSent:number;bytesSent:number}[]=[];stats?.forEach(x=>{if(x.type==='outbound-rtp'&&x.kind==='audio')media.push({packetsSent:x.packetsSent,bytesSent:x.bytesSent});});return {events:test.voiceTestEvents,responses:test.voiceTestResponses,media};});console.log(JSON.stringify({voiceDiagnostics:diagnostics}));throw error;}
  let stopped=1;
  const waitForReply=async()=>{await page.waitForFunction(min=>((window as Window&{voiceTestEvents?:string[]}).voiceTestEvents?.filter(type=>type==='output_audio_buffer.stopped').length??0)>min,stopped,{timeout:12000});stopped=await page.evaluate(()=>(window as Window&{voiceTestEvents?:string[]}).voiceTestEvents?.filter(type=>type==='output_audio_buffer.stopped').length??0);};
  for(let step=0;step<4;step++){
   const current=await state();if(!current||current.status!=='active')throw Error(`Voice session closed before contact: ${current?.status}`);
   if(/Enter your name|contact method/i.test(current.engine_state.directive))break;
   let next:string;if(/Choose a service/i.test(current.engine_state.directive))next='Voice Consultation.';else if(/Choose a local booking date/i.test(current.engine_state.directive))next=`On ${spokenDate}.`;else if(/Choose your preferred resource/i.test(current.engine_state.directive))next='Voice Consultant.';else if(current.engine_state.candidates.length)next='I want the first available time.';else throw Error(`Unexpected booking stage: ${current.engine_state.directive}`);
   await waitForReply();await play(next);await expect.poll(async()=>((await state())?.state_revision??current.state_revision),{timeout:15000}).toBeGreaterThan(current.state_revision);
  }
  await expect.poll(async()=>((await state())?.engine_state.directive??''),{timeout:12000}).toMatch(/Enter your name|contact method/i);
  await waitForReply();
  await play('My name is Alice Smith. My email is alice at example dot com.');
  await expect.poll(async()=>Boolean((await state())?.engine_state.pending),{timeout:15000}).toBe(true);
  await expect.poll(async()=>Boolean((await state())?.engine_state.pending?.voiceEligible),{timeout:30000}).toBe(true);
  expect((await database.query("select a.id from appointments a join action_proposals p on p.business_id=a.business_id and p.result->>'recordId'=a.id::text where p.voice_session_id=$1",[sessionId])).rowCount).toBe(0);
  await play('Yes please.');
  await expect.poll(async()=>(await database.query("select count(*)::int as count from appointments a join action_proposals p on p.business_id=a.business_id and p.result->>'recordId'=a.id::text where p.voice_session_id=$1 and a.source=$2",[sessionId,'owner_test'])).rows[0].count,{timeout:15000}).toBe(1);
  await live.getByRole('button',{name:'End call on server'}).click();await expect(live.getByRole('status')).toContainText('closed',{timeout:15000});
  const final=await state();expect(final?.engine_state.receipts).toHaveLength(1);console.log(JSON.stringify({liveBookingSessionId:sessionId,usageComplete:(await database.query('select usage_complete from voice_sessions where id=$1',[sessionId])).rows[0].usage_complete}));
 }finally{
  if(sessionId){const row=await state().catch(()=>undefined);if(row&&row.status!=='closed'&&row.status!=='failed'){await page.getByRole('button',{name:'End call on server'}).click().catch(()=>{});}}
  await database.end();
 }
});
