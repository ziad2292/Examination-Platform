import { Brand } from "@/components/brand";
import Link from "next/link";
import { LogOut } from "lucide-react";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { signOut } from "@/app/actions/auth";
import type { Profile } from "@/lib/types";
import { roleHome } from "@/lib/auth-policy";

export function SiteHeader({viewer}:{viewer?:Profile|null}){
  return <header className="border-b border-black/10 bg-white/85 backdrop-blur"><div className="shell flex min-h-16 items-center justify-between gap-3 py-2"><Brand/><nav aria-label="Primary navigation" className="flex items-center justify-end gap-1 text-sm sm:gap-2">{viewer?<><span className="hidden max-w-40 truncate px-2 text-black/55 md:inline">{viewer.full_name}</span><Link className="btn-ghost" href={roleHome(viewer.role)}>Dashboard</Link><form action={signOut}><PendingSubmitButton className="btn-ghost" pendingLabel="Signing out…"><LogOut size={16} aria-hidden="true"/><span className="sr-only sm:not-sr-only">Sign out</span></PendingSubmitButton></form></>:<Link className="btn-primary !min-h-10 !px-4" href="/login">Sign in</Link>}</nav></div></header>;
}
