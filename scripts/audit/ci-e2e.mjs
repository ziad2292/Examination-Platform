import { execFileSync, execSync, spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

// Keep local CLI credentials in child-process environments, out of CI logs and
// GITHUB_ENV. This runner never accepts remote Supabase endpoints.
let status;
try {
  let output;
  try {
    output=execFileSync('supabase',['status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
  } catch {
    // Local Windows setups may expose the CLI through npx instead of PATH.
    output=execSync('npx --no-install supabase status -o json',{encoding:'utf8',stdio:['ignore','pipe','pipe']});
  }
  status=JSON.parse(output);
} catch { throw new Error('Local Supabase status is unavailable'); }
if (!/^http:\/\/(localhost|127\.0\.0\.1):54321$/.test(status.API_URL)) throw new Error('Disposable local Supabase required');
const port=Number(process.env.AUDIT_E2E_PORT || 3000);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid local test port');
const env={...process.env,NEXT_PUBLIC_SUPABASE_URL:status.API_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY:status.ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY:status.SERVICE_ROLE_KEY,NEXT_PUBLIC_INTEGRITY_ENABLED:'true',
  E2E_INTEGRITY:'true',E2E_REGISTRATION:'true',E2E_BASE_URL:`http://localhost:${port}`};
function run(args){return new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,args,{env,stdio:'inherit',windowsHide:true});
  child.once('error',()=>reject(new Error('Test command could not start')));
  child.once('exit',code=>code===0?resolve():reject(new Error(`Test command failed (${code})`)));
});}
await run(['node_modules/next/dist/bin/next','build','--webpack']);
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-p',String(port)],{env,stdio:'inherit',windowsHide:true});
let stopped=false;
server.once('exit',()=>{stopped=true;});
server.once('error',()=>{stopped=true;});
try {
  let ready=false;
  for(let i=0;i<60;i++){
    if(stopped)throw new Error('Test preview exited before readiness');
    try{const response=await fetch(`${env.E2E_BASE_URL}/login`,{signal:AbortSignal.timeout(1000)}); if(response.ok){ready=true;break;}}catch{}
    await delay(500);
  }
  if(!ready)throw new Error('Test preview readiness timed out');
  await run(['node_modules/@playwright/test/cli.js','test']);
}finally{server.kill('SIGTERM');}
