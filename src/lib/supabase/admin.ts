import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "./config";

function getAdminKey() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key || key.startsWith("replace-") || key.includes("your-service-role")) return null;
  return key;
}

export function hasAdminConfig() {
  return Boolean(getAdminKey());
}

export function createAdminClient() {
  const { url } = getSupabaseConfig();
  const key = getAdminKey();
  if (!key) throw new Error("Server-side user administration is not configured.");
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
