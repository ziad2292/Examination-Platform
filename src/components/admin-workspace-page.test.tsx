import { beforeEach, describe, expect, it, vi } from 'vitest';
const calls = vi.hoisted(() => ({ tables: [] as string[], rpcs: [] as string[] }));
vi.mock('@/lib/auth', () => ({requireRole: async()=>({id:'admin',role:'superadmin'})}));
vi.mock('@/lib/supabase/admin', () => ({hasAdminConfig:()=>false,createAdminClient:vi.fn()}));
vi.mock('@/lib/supabase/server', () => ({createClient: async()=>({
  from(table:string) {
    const chain = {
      select(){return chain;},order(){return chain;},range(){return chain;},or(){return chain;},eq(){return chain;},limit(){return chain;},
      then(resolve:(result:{data:unknown[]})=>unknown){calls.tables.push(table);return Promise.resolve(resolve({data:[]}));},
    };
    return chain;
  },
  rpc(name:string){calls.rpcs.push(name);return Promise.resolve({data:[]});},
})}));
import AdminPage from './admin-workspace-page';
beforeEach(()=>{calls.tables=[];calls.rpcs=[];});
describe('admin workspace query scope',()=>{
  it.each(['create','import'])('%s does not fetch unused roster or history',async area=>{
    await AdminPage({area,searchParams:Promise.resolve({})});
    expect(calls.tables).toEqual([]); expect(calls.rpcs).toEqual([]);
  });
  it('accounts preserves history checks without fetching assignment or cleanup data',async()=>{
    await AdminPage({area:'accounts',searchParams:Promise.resolve({})});
    expect(calls.tables).toEqual(['profiles']); expect(calls.rpcs).toEqual(['admin_user_history_summary']);
  });
  it('student management fetches both students and teachers',async()=>{
    await AdminPage({area:'students',searchParams:Promise.resolve({})});
    expect(calls.tables).toEqual(['profiles','profiles']); expect(calls.rpcs).toEqual([]);
  });
  it('danger zone preserves its authorized cleanup preview',async()=>{
    await AdminPage({area:'data',searchParams:Promise.resolve({})});
    expect(calls.tables).toEqual([]); expect(calls.rpcs).toEqual(['admin_cleanup_preview']);
  });
});
