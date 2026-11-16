"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { FormActionState } from "@/lib/form-state";

export async function saveAdminIntegrityPolicy(_: FormActionState, form: FormData): Promise<FormActionState> {
  await requireRole("superadmin");
  const fields = ["threshold", "cooldown_seconds", "attention_seconds", "heartbeat_seconds", "stale_seconds", "delayed_seconds", "queue_limit", "retention_days"];
  const settings = Object.fromEntries(fields.map(key => [key, Number(form.get(key))]));
  const db = await createClient();
  const { error } = await db.rpc("save_admin_integrity_policy", { settings });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/admin/integrity");
  return { ok: true, message: "Integrity policy saved." };
}
