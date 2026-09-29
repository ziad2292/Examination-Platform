"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { createAdminClient, hasAdminConfig } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const idSchema = z.guid();
const roleSchema = z.enum(["superadmin", "teacher", "student"]);
const creatableRoleSchema = z.enum(["teacher", "student"]);
const emailSchema = z.email().max(254);
const passwordSchema = z.string().min(12).max(128)
  .regex(/[a-z]/).regex(/[A-Z]/).regex(/[0-9]/).regex(/[^A-Za-z0-9]/);

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function adminRedirect(code: string): never {
  redirect(`/admin?notice=${code}`);
}

function isDuplicateEmailError(code?: string) {
  return code === "email_exists" || code === "user_already_exists";
}

function requireAdminConfiguration() {
  if (!hasAdminConfig()) adminRedirect("admin_config_missing");
  return createAdminClient();
}

export async function createManagedUser(formData: FormData) {
  const viewer = await requireRole("superadmin");
  const parsed = z.object({
    fullName: z.string().trim().min(2).max(120),
    email: emailSchema,
    role: creatableRoleSchema,
    password: passwordSchema,
  }).safeParse({
    fullName: value(formData, "fullName"),
    email: value(formData, "email").toLowerCase(),
    role: value(formData, "role"),
    password: value(formData, "password"),
  });
  if (!parsed.success) adminRedirect("invalid_user");
  const admin = requireAdminConfiguration();
  const { data, error } = await admin.auth.admin.createUser({
    email: parsed.data.email,
    password: parsed.data.password,
    email_confirm: true,
    user_metadata: {
      full_name: parsed.data.fullName,
      role: parsed.data.role,
    },
  });
  if (error || !data.user) {
    console.error("Managed user creation failed", { code: error?.code });
    adminRedirect(isDuplicateEmailError(error?.code) ? "duplicate_email" : "create_failed");
  }
  const profile = await admin.from("profiles").insert({
    id: data.user.id,
    full_name: parsed.data.fullName,
    email: parsed.data.email,
    role: parsed.data.role,
  });
  if (profile.error) {
    await admin.auth.admin.deleteUser(data.user.id);
    console.error("Managed profile creation failed", { code: profile.error.code });
    adminRedirect(profile.error.code === "23505" ? "duplicate_email" : "create_failed");
  }
  const audit = await admin.from("admin_audit_events").insert({
    actor_id: viewer.id,
    action: "user.created",
    target_type: "user",
    target_id: data.user.id,
    reason: "Created through Super Admin user management",
    after_state: { email: parsed.data.email, role: parsed.data.role, active: true },
    idempotency_key: crypto.randomUUID(),
  });
  if (audit.error) {
    await admin.auth.admin.deleteUser(data.user.id);
    console.error("Managed user audit failed", { code: audit.error.code });
    adminRedirect("create_failed");
  }
  revalidatePath("/admin");
  adminRedirect("user_created");
}

export async function updateManagedUser(formData: FormData) {
  const viewer = await requireRole("superadmin");
  const parsed = z.object({
    userId: idSchema,
    fullName: z.string().trim().min(2).max(120),
    email: emailSchema,
    role: roleSchema,
    active: z.boolean(),
    reason: z.string().trim().min(3).max(1000),
    operationKey: idSchema,
  }).safeParse({
    userId: value(formData, "userId"),
    fullName: value(formData, "fullName"),
    email: value(formData, "email").toLowerCase(),
    role: value(formData, "role"),
    active: value(formData, "active") === "true",
    reason: value(formData, "reason"),
    operationKey: value(formData, "operationKey"),
  });
  if (!parsed.success) adminRedirect("invalid_update");
  const admin = requireAdminConfiguration();
  const supabase = await createClient();
  const { data: current, error: currentError } = await supabase.from("profiles").select("email,is_active").eq("id", parsed.data.userId).single();
  if (currentError || !current) adminRedirect("update_failed");
  const authUpdate = await admin.auth.admin.updateUserById(parsed.data.userId, {
    email: parsed.data.email,
    email_confirm: true,
    ban_duration: parsed.data.active ? "none" : "876000h",
  });
  if (authUpdate.error) {
    console.error("Managed auth update failed", { code: authUpdate.error.code });
    adminRedirect(isDuplicateEmailError(authUpdate.error.code) ? "duplicate_email" : "update_failed");
  }
  const { error } = await supabase.rpc("admin_update_user_profile", {
    target_user: parsed.data.userId,
    new_full_name: parsed.data.fullName,
    new_email: parsed.data.email,
    new_role: parsed.data.role,
    new_active: parsed.data.active,
    change_reason: parsed.data.reason,
    operation_key: parsed.data.operationKey,
  });
  if (error) {
    await admin.auth.admin.updateUserById(parsed.data.userId, {
      email: current.email,
      email_confirm: true,
      ban_duration: current.is_active ? "none" : "876000h",
    });
    console.error("Managed profile update failed", { code: error.code });
    adminRedirect("update_rejected");
  }
  revalidatePath("/admin");
  if (parsed.data.userId === viewer.id && parsed.data.role !== "superadmin") redirect("/dashboard");
  adminRedirect(parsed.data.active ? "user_updated" : "user_deactivated");
}

export async function deleteManagedUser(formData: FormData) {
  const viewer = await requireRole("superadmin");
  const userId = idSchema.safeParse(value(formData, "userId"));
  const email = emailSchema.safeParse(value(formData, "email").toLowerCase());
  if (!userId.success || !email.success || value(formData, "confirmationEmail") !== email.data) {
    adminRedirect("delete_confirmation_failed");
  }
  const supabase = await createClient();
  const eligibility = await supabase.rpc("admin_assert_user_deletable", { target_user: userId.data });
  if (eligibility.error) adminRedirect("delete_requires_deactivation");
  const admin = requireAdminConfiguration();
  const operationKey = crypto.randomUUID();
  const { data: audit, error: auditError } = await admin.from("admin_audit_events").insert({
    actor_id: viewer.id,
    action: "user.delete_requested",
    target_type: "user",
    target_id: userId.data,
    reason: "Permanent deletion of an account without historical data",
    before_state: { email: email.data },
    idempotency_key: operationKey,
  }).select("id").single();
  if (auditError || !audit) {
    console.error("Managed deletion audit failed", { code: auditError?.code });
    adminRedirect("delete_failed");
  }
  const deletion = await admin.auth.admin.deleteUser(userId.data);
  if (deletion.error) {
    console.error("Managed user deletion failed", { code: deletion.error.code });
    adminRedirect("delete_failed");
  }
  await admin.from("admin_audit_events").update({ action: "user.deleted", after_state: { deleted: true } }).eq("id", audit.id);
  revalidatePath("/admin");
  adminRedirect("user_deleted");
}
