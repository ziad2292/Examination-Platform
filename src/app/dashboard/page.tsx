import { redirect } from "next/navigation"; import { getViewer } from "@/lib/auth";
export default async function Dashboard(){const viewer=await getViewer();if(!viewer)redirect("/login");redirect(viewer.role==="teacher"?"/teacher":"/student");}
