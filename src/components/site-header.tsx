import Link from "next/link";
import { LogOut,Mountain } from "lucide-react";
import { signOut } from "@/app/actions/auth";
import type { Profile } from "@/lib/types";

export function SiteHeader({viewer}:{viewer?:Profile|null}){
  return <header className="border-b border-black/10 bg-white/85 backdrop-blur"><div className="shell flex min-h-16 items-center justify-between gap-3 py-2"><Link href="/" className="flex shrink-0 items-center gap-2 font-bold tracking-tight"><span className="grid size-9 place-items-center rounded-xl bg-brand text-white"><Mountain size={19}/></span><span className="hidden sm:inline">Summit SAT</span></Link><nav aria-label="Primary navigation" className="flex items-center justify-end gap-1 text-sm sm:gap-2">{viewer?<><span className="hidden max-w-40 truncate px-2 text-black/55 md:inline">{viewer.full_name}</span><Link className="btn-ghost" href={viewer.role==="teacher"?"/teacher":"/student"}>Dashboard</Link><form action={signOut}><button className="btn-ghost" type="submit" aria-label="Sign out"><LogOut size={16}/><span className="hidden sm:inline">Sign out</span></button></form></>:<Link className="btn-primary !min-h-10 !px-4" href="/login">Sign in</Link>}</nav></div></header>;
}
