import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { maskEmail, readSuperadminBootstrapConfig } from "./lib/superadmin-bootstrap-config.mjs";

function stableOperationKey(userId) {
  const bytes = Buffer.from(createHash("sha256").update(`summit-superadmin-bootstrap:${userId}`).digest().subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function findAuthUserByEmail(admin, email) {
  const perPage = 1000;
  for (let page = 1; page <= 10000; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`Supabase Auth lookup failed (${error.code ?? "unknown"}).`);
    const user = data.users.find((candidate) => candidate.email?.toLowerCase() === email);
    if (user) return user;
    if (data.users.length < perPage || (data.total && page * perPage >= data.total)) return null;
  }
  throw new Error("Supabase Auth lookup exceeded the safety pagination limit.");
}

async function recordBootstrapAudit(admin, userId, email, created) {
  const { error } = await admin.from("admin_audit_events").insert({
    actor_id: userId,
    action: "user.superadmin_bootstrapped",
    target_type: "user",
    target_id: userId,
    reason: created ? "Initial Super Admin created from protected deployment environment" : "Super Admin bootstrap verified from protected deployment environment",
    after_state: { email, role: "superadmin", active: true, created },
    idempotency_key: stableOperationKey(userId),
  });
  if (error && error.code !== "23505") throw new Error(`Bootstrap audit failed (${error.code}).`);
}

export async function bootstrapSuperadmin(env = process.env) {
  const config = readSuperadminBootstrapConfig(env);
  const admin = createClient(config.url, config.serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  let authUser = await findAuthUserByEmail(admin, config.email);
  let created = false;

  if (!authUser) {
    const creation = await admin.auth.admin.createUser({
      email: config.email,
      password: config.password,
      email_confirm: true,
      user_metadata: { full_name: config.fullName, role: "superadmin", bootstrap_source: "environment" },
    });
    if (creation.error || !creation.data.user) throw new Error(`Super Admin Auth creation failed (${creation.error?.code ?? "unknown"}).`);
    authUser = creation.data.user;
    created = true;
  }

  const { data: currentProfile, error: profileLookupError } = await admin.from("profiles")
    .select("id,full_name,email,role,is_active,deactivated_at,deactivated_by")
    .eq("id", authUser.id)
    .maybeSingle();
  if (profileLookupError) {
    if (created) await admin.auth.admin.deleteUser(authUser.id);
    throw new Error(`Super Admin profile lookup failed (${profileLookupError.code}).`);
  }
  if (currentProfile && currentProfile.role !== "superadmin" && !config.allowPromotion) {
    throw new Error("An account with this email already has a non-Super-Admin profile. Set BOOTSTRAP_SUPERADMIN_ALLOW_PROMOTION=true only after verifying that account.");
  }

  const profile = currentProfile
    ? await admin.from("profiles").update({
      full_name: config.fullName,
      email: config.email,
      role: "superadmin",
      is_active: true,
      deactivated_at: null,
      deactivated_by: null,
    }).eq("id", authUser.id)
    : await admin.from("profiles").insert({ id: authUser.id, full_name: config.fullName, email: config.email, role: "superadmin", is_active: true });
  if (profile.error) {
    if (created) await admin.auth.admin.deleteUser(authUser.id);
    throw new Error(`Super Admin profile synchronization failed (${profile.error.code}).`);
  }

  try {
    await recordBootstrapAudit(admin, authUser.id, config.email, created);
  } catch (error) {
    if (created) {
      await admin.auth.admin.deleteUser(authUser.id);
    } else if (!currentProfile) {
      await admin.from("profiles").delete().eq("id", authUser.id);
    } else {
      await admin.from("profiles").update({
        full_name: currentProfile.full_name,
        email: currentProfile.email,
        role: currentProfile.role,
        is_active: currentProfile.is_active,
        deactivated_at: currentProfile.deactivated_at,
        deactivated_by: currentProfile.deactivated_by,
      }).eq("id", authUser.id);
    }
    throw error;
  }

  if (!created && config.rotatePassword) {
    const passwordUpdate = await admin.auth.admin.updateUserById(authUser.id, { password: config.password });
    if (passwordUpdate.error) throw new Error(`Super Admin password rotation failed (${passwordUpdate.error.code ?? "unknown"}).`);
  }

  return { created, email: config.email, passwordRotated: !created && config.rotatePassword };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  bootstrapSuperadmin()
    .then((result) => {
      const action = result.created ? "created" : result.passwordRotated ? "verified and rotated" : "verified";
      console.log(`Super Admin ${action}: ${maskEmail(result.email)}. No password was logged or stored in the bootstrap audit.`);
    })
    .catch((error) => {
      console.error(`Super Admin bootstrap failed: ${error instanceof Error ? error.message : "Unknown error"}`);
      process.exitCode = 1;
    });
}
