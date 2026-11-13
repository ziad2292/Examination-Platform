import { describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { signInWithPassword: async () => ({error:null}) } }) }));
import { signIn } from './auth';
describe('sign-in return destination', () => {
  it.each(['/\\outside.example', '//outside.example', '/\t/outside.example', 'https://outside.example'])('rejects external destination %j', async next => {
    const data = new FormData(); data.set('next',next);
    await expect(signIn(data)).rejects.toThrow('redirect:/dashboard');
  });
  it('preserves internal paths, query parameters and fragments', async () => {
    const data = new FormData(); data.set('next','/student?panel=history#latest');
    await expect(signIn(data)).rejects.toThrow('redirect:/student?panel=history#latest');
  });
});
