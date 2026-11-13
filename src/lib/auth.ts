import { cache } from "react"; import { redirect } from "next/navigation"; import { roleHome } from "./auth-policy"; import { createClient } from "./supabase/server"; import type { Profile,Role } from "./types";
export const getViewer=cache(async()=>{const supabase=await createClient();const {data:{user}}=await supabase.auth.getUser();if(!user)return null;const {data:profile}=await supabase.from("profiles").select("id,full_name,email,role,is_active").eq("id",user.id).single();if(!profile?.is_active)return null;return profile as Profile;});
export async function requireRole(role:Role){const viewer=await getViewer();if(!viewer){
  const db=await createClient();
  const {data:status}=await db.rpc("my_registration_status");
  if(status==="pending" || status==="rejected") redirect("/registration-status");
  redirect(`/login?next=${roleHome(role)}`);
}if(viewer.role!==role)redirect(roleHome(viewer.role));return viewer;}
