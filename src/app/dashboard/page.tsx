import { redirect } from "next/navigation"; import { getViewer } from "@/lib/auth"; import { roleHome } from "@/lib/auth-policy";
export default async function Dashboard(){const viewer=await getViewer();if(!viewer)redirect("/login");redirect(roleHome(viewer.role));}
