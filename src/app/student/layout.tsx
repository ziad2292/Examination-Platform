import { WorkspaceShell } from "@/components/workspace-shell";
import { requireRole } from "@/lib/auth";
export const metadata = { robots: { index: false, follow: false } };
export default async function Layout({children}:{children:React.ReactNode}) { const viewer=await requireRole("student"); return <WorkspaceShell viewer={viewer}>{children}</WorkspaceShell>; }
