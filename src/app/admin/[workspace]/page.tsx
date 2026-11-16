import { notFound } from "next/navigation";
import AdminPage from "@/components/admin-workspace-page";
export default async function AdminWorkspace({params,searchParams}:{params:Promise<{workspace:string}>;searchParams:Promise<{q?:string;role?:string;notice?:string}>}){const {workspace}=await params;if(!["students","accounts","import","data","create"].includes(workspace))notFound();return <AdminPage searchParams={searchParams} area={workspace}/>;}
