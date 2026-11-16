import { afterEach, describe, expect, it, vi } from 'vitest';
const rpc = vi.hoisted(() => vi.fn(async () => ({data:{enabled:true,acknowledged:[]},error:null})));
vi.mock('@/lib/supabase/server', () => ({createClient: async () => ({
  auth:{getUser:async()=>({data:{user:null}})},rpc,
})}));
import { handleIntegrityRequest } from './integrity-handler';
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe('integrity HTTP boundary', () => {
  const input = {attemptId:'ab100000-0000-4000-8000-000000000003',browserInstanceId:'ab100000-0000-4000-8000-000000000010',documentId:'ab100000-0000-4000-8000-000000000011',observations:[]};
  function request(body: string, headers: Record<string,string> = {}) {
    vi.stubEnv('NEXT_PUBLIC_INTEGRITY_ENABLED','true');
    return new Request('http://localhost/api/integrity/sync',{method:'POST',headers:{origin:'http://localhost','content-type':'application/json',...headers},body});
  }
  it('rejects cross-origin calls before database access', async()=>{
    expect((await handleIntegrityRequest(request(JSON.stringify(input),{origin:'https://outside.example'}),'sync')).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('rejects unsupported bodies',async()=>{
    expect((await handleIntegrityRequest(request('{}',{'content-type':'text/plain'}),'sync')).status).toBe(415);
  });
  it('bounds actual bytes even without a Content-Length header',async()=>{
    expect((await handleIntegrityRequest(request(' '.repeat(32769)),'sync')).status).toBe(413);
  });
  it('rejects malformed JSON',async()=>{
    expect((await handleIntegrityRequest(request('{'),'sync')).status).toBe(400);
  });
  it('rejects client-supplied aggregate counts',async()=>{
    expect((await handleIntegrityRequest(request(JSON.stringify({...input,count:0})),'sync')).status).toBe(400);
  });
  it('requires authentication for valid observations',async()=>{
    expect((await handleIntegrityRequest(request(JSON.stringify(input)),'sync')).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
});
