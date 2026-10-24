import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const server=fileURLToPath(new URL('../apps/api/dist/server.js',import.meta.url));
const child=spawn(process.execPath,[server],{env:{...process.env,API_PORT:'4001'},stdio:['ignore','ignore','inherit'],windowsHide:true});
try {
 child.once('error',error=>{process.stderr.write(error.message+'\n');});
 let ready=false;
 for(let attempt=0;attempt<40;attempt++){
  if(child.exitCode!==null)throw new Error('Built API exited before readiness');
  try{const response=await fetch('http://127.0.0.1:4001/api/v1/health',{signal:AbortSignal.timeout(500)});if(response.ok&&(await response.json()).ok){ready=true;break;}}catch{}
  await new Promise(resolve=>setTimeout(resolve,250));
 }
 if(!ready)throw new Error('Built API did not become ready');
 const response=await fetch('http://127.0.0.1:4001/api/v1/public/__missing__/receptionist');
 if(response.status!==404||(await response.json()).error.code!=='NOT_FOUND')throw new Error('Built database-backed route failed');
 process.stdout.write('Built API started; health and database-backed Phase 2 route passed.\n');
}finally{child.kill('SIGTERM');}
