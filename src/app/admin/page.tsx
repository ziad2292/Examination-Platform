import { ShieldCheck, UserPlus, Users } from "lucide-react";
import { createManagedUser, deleteManagedUser, updateManagedUser } from "@/app/actions/user-administration";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { requireRole } from "@/lib/auth";
import { formatAppDateTime } from "@/lib/date-time";
import { hasAdminConfig } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Profile, Role } from "@/lib/types";

type History = { user_id: string; exam_count: number; attempt_count: number; audit_count: number };

const notices: Record<string, { message: string; error?: boolean }> = {
  admin_config_missing: { message: "User changes are unavailable until the server administrator key is configured.", error: true },
  invalid_user: { message: "Check the name, email, role, and temporary-password requirements.", error: true },
  duplicate_email: { message: "That email address is already assigned to an account.", error: true },
  create_failed: { message: "The account could not be created. No partial account was retained.", error: true },
  user_created: { message: "The account was created successfully." },
  invalid_update: { message: "Check every account field and provide a reason for the change.", error: true },
  update_failed: { message: "The account could not be updated. Its existing settings were retained.", error: true },
  update_rejected: { message: "That change is not allowed because it would weaken account or history protections.", error: true },
  user_updated: { message: "The account was updated successfully." },
  user_deactivated: { message: "The account was deactivated and can no longer sign in." },
  delete_confirmation_failed: { message: "Deletion was cancelled because the email confirmation did not match.", error: true },
  delete_requires_deactivation: { message: "This account has protected history and must be deactivated instead of deleted.", error: true },
  delete_failed: { message: "The account could not be deleted. Try again after checking its history.", error: true },
  user_deleted: { message: "The history-free account was deleted permanently." },
};

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ q?: string; role?: string; notice?: string }> }) {
  const viewer = await requireRole("superadmin");
  const filters = await searchParams;
  const query = (filters.q ?? "").trim().slice(0, 120);
  const role = (["superadmin", "teacher", "student"] as const).includes(filters.role as Role) ? filters.role as Role : "";
  const supabase = await createClient();
  let usersQuery = supabase.from("profiles").select("id,full_name,email,role,is_active,created_at").order("created_at", { ascending: false });
  if (query) usersQuery = usersQuery.or(`full_name.ilike.%${query.replaceAll(/[,%()]/g, "")}%,email.ilike.%${query.replaceAll(/[,%()]/g, "")}%`);
  if (role) usersQuery = usersQuery.eq("role", role);
  const [{ data: users }, { data: historyRows }] = await Promise.all([usersQuery, supabase.rpc("admin_user_history_summary")]);
  const history = new Map(((historyRows ?? []) as History[]).map((row) => [row.user_id, row]));
  const configured = hasAdminConfig();
  const notice = filters.notice ? notices[filters.notice] : undefined;

  return <div>
    <div className="flex flex-wrap items-start justify-between gap-5"><div><p className="eyebrow">Super Admin</p><h1 className="mt-2 text-4xl font-bold tracking-tight">User administration</h1><p className="mt-3 max-w-2xl text-black/55">Create and maintain teacher and student access without sacrificing historical exam records.</p></div><span className="inline-flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-bold text-brand"><ShieldCheck size={18} />Protected administration</span></div>
    {notice && <p role={notice.error ? "alert" : "status"} className={`mt-6 rounded-xl border p-4 text-sm font-semibold ${notice.error ? "border-red-200 bg-red-50 text-red-700" : "border-green-200 bg-green-50 text-green-800"}`}>{notice.message}</p>}
    {!configured && <p role="alert" className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">User mutations are unavailable because the server-only Supabase service role key is not configured. User data remains readable through protected RLS.</p>}

    <section className="card mt-8 p-5 sm:p-6"><div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-green-50 text-brand"><UserPlus size={19} /></span><div><h2 className="font-bold">Create user</h2><p className="text-sm text-black/45">Creates Auth and profile records together.</p></div></div><form action={createManagedUser} className="mt-6 grid gap-4 lg:grid-cols-4"><label><span className="label">Full name</span><input className="field" name="fullName" minLength={2} maxLength={120} required disabled={!configured} /></label><label><span className="label">Email</span><input className="field" name="email" type="email" required disabled={!configured} /></label><label><span className="label">Role</span><select className="field" name="role" disabled={!configured}><option value="student">Student</option><option value="teacher">Teacher</option></select></label><label><span className="label">Temporary password</span><input className="field" name="password" type="password" minLength={12} autoComplete="new-password" required disabled={!configured} /></label><p className="text-xs leading-5 text-black/45 lg:col-span-3">Use at least 12 characters with uppercase, lowercase, number, and symbol. Deliver it through an approved private channel.</p><button className="btn-primary" disabled={!configured}><UserPlus size={17} />Create user</button></form></section>

    <section className="mt-8"><div className="flex items-center gap-3"><Users className="text-brand" /><div><h2 className="text-xl font-bold">Accounts</h2><p className="text-sm text-black/45">{users?.length ?? 0} matching users</p></div></div><form className="card mt-4 grid gap-4 p-5 sm:grid-cols-[1fr_220px_auto]"><label><span className="label">Search</span><input className="field" name="q" defaultValue={query} placeholder="Name or email" /></label><label><span className="label">Role</span><select className="field" name="role" defaultValue={role}><option value="">All roles</option><option value="superadmin">Super Admin</option><option value="teacher">Teacher</option><option value="student">Student</option></select></label><button className="btn-secondary self-end">Filter users</button></form>
      <div className="mt-5 space-y-4">{(users as Profile[] | null)?.map((user) => { const counts = history.get(user.id) ?? { exam_count: 0, attempt_count: 0, audit_count: 0 }; const hasHistory = Number(counts.exam_count) + Number(counts.attempt_count) + Number(counts.audit_count) > 0; return <article className="card p-5" key={user.id}><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-bold">{user.full_name}</h3><p className="text-sm text-black/50">{user.email}</p><p className="mt-2 text-xs font-semibold uppercase tracking-wide text-black/40">{user.role} · {user.is_active ? "Active" : "Inactive"} · Created {user.created_at ? formatAppDateTime(user.created_at) : "—"}</p></div>{hasHistory && <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-800">History protected</span>}</div>
        <form action={updateManagedUser} className="mt-5 grid gap-4 border-t border-black/10 pt-5 md:grid-cols-2 xl:grid-cols-5"><input type="hidden" name="userId" value={user.id} /><input type="hidden" name="operationKey" value={crypto.randomUUID()} />{hasHistory && <input type="hidden" name="role" value={user.role} />}<label><span className="label">Name</span><input className="field" name="fullName" defaultValue={user.full_name} required disabled={!configured} /></label><label><span className="label">Email</span><input className="field" name="email" type="email" defaultValue={user.email} required disabled={!configured} /></label><label><span className="label">Role</span><select className="field" name={hasHistory ? undefined : "role"} defaultValue={user.role} disabled={!configured || hasHistory}><option value="superadmin">Super Admin</option><option value="teacher">Teacher</option><option value="student">Student</option></select></label><label><span className="label">Status</span><select className="field" name="active" defaultValue={String(user.is_active)} disabled={!configured}><option value="true">Active</option><option value="false">Inactive</option></select></label><label><span className="label">Reason</span><input className="field" name="reason" minLength={3} maxLength={1000} required placeholder="Reason for change" disabled={!configured} /></label><div className="md:col-span-2 xl:col-span-5 flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-black/45">{hasHistory ? "Role changes and hard deletion are disabled because historical records exist." : "This account has no exam, attempt, or audit history."}</p><ConfirmSubmitButton className="btn-secondary" label="Save account changes" confirmation={`Apply account changes to ${user.full_name}? Role and status changes affect their access immediately.`} disabled={!configured} /></div></form>
        <div className="mt-4 flex justify-end">{hasHistory ? <p className="text-xs font-semibold text-amber-700">Deactivate this account instead of deleting it.</p> : <form action={deleteManagedUser}><input type="hidden" name="userId" value={user.id} /><input type="hidden" name="email" value={user.email} /><input type="hidden" name="confirmationEmail" value={user.email} /><ConfirmSubmitButton className="btn-danger" label="Delete eligible user" requiredText={user.email} confirmation={`Permanently delete ${user.full_name}? This account has no historical data. Type the exact email to continue.`} disabled={!configured || user.id === viewer.id} /></form>}</div>
      </article>;})}{!users?.length && <div className="card p-10 text-center text-black/45">No users match the selected filters.</div>}</div>
    </section>
  </div>;
}
