import AdminWorkspacePage from "@/components/admin-workspace-page";
export default function AdminPage({searchParams}:{searchParams:Promise<{q?:string;role?:string;notice?:string}>}) { return <AdminWorkspacePage searchParams={searchParams}/>; }
