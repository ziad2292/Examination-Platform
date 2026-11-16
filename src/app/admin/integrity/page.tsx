import {
  AdminIntegrityPolicy,
  type IntegrityConstants,
} from "@/components/admin-integrity-policy";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function IntegrityPolicyPage() {
  await requireRole("superadmin");
  const db = await createClient();
  const { data, error } = await db.rpc("admin_integrity_policy");
  if (error || !data)
    return (
      <section className="card p-6">
        <h1 className="text-2xl font-bold">Integrity policy</h1>
        <p role="alert" className="mt-4 text-sm text-red-800">
          The system policy could not be loaded. Check that the latest database
          migration is applied and refresh this page.
        </p>
      </section>
    );
  return <AdminIntegrityPolicy policy={data as IntegrityConstants} />;
}
