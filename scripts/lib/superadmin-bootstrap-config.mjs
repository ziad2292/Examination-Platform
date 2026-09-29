import { z } from "zod";

const passwordSchema = z.string().min(12).max(128)
  .regex(/[a-z]/, "must include a lowercase letter")
  .regex(/[A-Z]/, "must include an uppercase letter")
  .regex(/[0-9]/, "must include a number")
  .regex(/[^A-Za-z0-9]/, "must include a symbol");

function required(env, name, trim = true) {
  const raw = env[name];
  const value = trim ? raw?.trim() : raw;
  if (!value || value.startsWith("replace-") || value.startsWith("your-")) {
    throw new Error(`${name} is required and cannot contain a placeholder value.`);
  }
  return value;
}

function booleanValue(env, name, defaultValue = false) {
  const raw = env[name]?.trim().toLowerCase();
  if (!raw) return defaultValue;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`${name} must be either true or false.`);
}

export function readSuperadminBootstrapConfig(env) {
  if (!booleanValue(env, "BOOTSTRAP_SUPERADMIN_ENABLED")) {
    throw new Error("BOOTSTRAP_SUPERADMIN_ENABLED must be true for this one-time command.");
  }
  const url = required(env, "NEXT_PUBLIC_SUPABASE_URL");
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") throw new Error();
  } catch {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must be a valid HTTP or HTTPS URL.");
  }
  const serviceRoleKey = required(env, "SUPABASE_SERVICE_ROLE_KEY");
  const fullName = required(env, "BOOTSTRAP_SUPERADMIN_FULL_NAME");
  if (fullName.length < 2 || fullName.length > 120) {
    throw new Error("BOOTSTRAP_SUPERADMIN_FULL_NAME must contain 2–120 characters.");
  }
  const emailResult = z.email().max(254).safeParse(required(env, "BOOTSTRAP_SUPERADMIN_EMAIL").toLowerCase());
  if (!emailResult.success) throw new Error("BOOTSTRAP_SUPERADMIN_EMAIL must be a valid email address.");
  const passwordResult = passwordSchema.safeParse(required(env, "BOOTSTRAP_SUPERADMIN_PASSWORD", false));
  if (!passwordResult.success) {
    throw new Error(`BOOTSTRAP_SUPERADMIN_PASSWORD ${passwordResult.error.issues.map((issue) => issue.message).join(", ")}.`);
  }
  return {
    url,
    serviceRoleKey,
    fullName,
    email: emailResult.data,
    password: passwordResult.data,
    rotatePassword: booleanValue(env, "BOOTSTRAP_SUPERADMIN_ROTATE_PASSWORD"),
    allowPromotion: booleanValue(env, "BOOTSTRAP_SUPERADMIN_ALLOW_PROMOTION"),
  };
}

export function maskEmail(email) {
  const [local, domain] = email.split("@");
  return `${local.slice(0, 2)}***@${domain}`;
}
