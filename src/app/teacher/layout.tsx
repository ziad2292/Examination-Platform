import { SiteHeader } from "@/components/site-header"; import { requireRole } from "@/lib/auth";
export default async function TeacherLayout({children}:{children:React.ReactNode}){const viewer=await requireRole("teacher");return <><SiteHeader viewer={viewer}/><main className="shell flex-1 py-8 sm:py-12">{children}</main></>}
