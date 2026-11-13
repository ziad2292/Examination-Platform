import { WorkspaceShell } from "@/components/workspace-shell";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
export const metadata = { robots: { index: false, follow: false } };
export default async function Layout({children}:{children:React.ReactNode}) { const viewer=await requireRole("superadmin"); const db=await createClient(); const {count}=await db.from("profiles").select("id",{count:"exact",head:true}).eq("approval_status","pending"); return <WorkspaceShell viewer={viewer} pendingApprovals={count??0}>{children}</WorkspaceShell>; }
