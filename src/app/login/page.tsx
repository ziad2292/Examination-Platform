import type { Metadata } from "next";
import { signIn } from "@/app/actions/auth";
import { SiteHeader } from "@/components/site-header";
import { hasSupabaseConfig } from "@/lib/supabase/config";

export const metadata:Metadata={title:"Sign in"};
const messages:Record<string,string>={invalid_credentials:"That email or password is incorrect. Please try again.",service_unavailable:"Sign-in is temporarily unavailable. Please try again in a moment."};

export default async function LoginPage({searchParams}:{searchParams:Promise<{error?:string;next?:string}>}){
  const q=await searchParams,configured=hasSupabaseConfig(),message=q.error?messages[q.error]??messages.service_unavailable:null;
  return <><SiteHeader/><main className="shell grid flex-1 place-items-center py-16 sm:py-24"><section className="card w-full max-w-md p-7 sm:p-10"><p className="eyebrow">Welcome back</p><h1 className="mt-3 text-3xl font-bold tracking-tight">Sign in to your account</h1><p className="mt-3 text-sm leading-6 text-black/55">Enter the email and password provided by your teacher or administrator.</p>{!configured&&<p role="alert" className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Sign-in is temporarily unavailable.</p>}{message&&<p role="alert" className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{message}</p>}<form action={signIn} className="mt-8 space-y-5"><input type="hidden" name="next" value={q.next??""}/><label className="block"><span className="label">Email address</span><input className="field" name="email" type="email" autoComplete="email" required/></label><label className="block"><span className="label">Password</span><input className="field" name="password" type="password" autoComplete="current-password" required minLength={8}/></label><div className="pt-3"><button className="btn-primary w-full" disabled={!configured}>Sign in</button></div></form><p className="mt-6 text-center text-xs leading-5 text-black/45">Having trouble signing in? Contact your teacher or administrator for help.</p></section></main></>;
}
