"use client";

import { useActionState } from "react";
import { CheckCircle2, FileSpreadsheet, ShieldCheck, Upload, XCircle } from "lucide-react";
import { manageBulkUserImport, type BulkUserImportState } from "@/app/actions/bulk-user-import";

const initialBulkUserImportState: BulkUserImportState = { ok: false, phase: "idle", message: "", rows: [] };

function RowStatus({ valid, status }: { valid: boolean; status?: string }) {
  if (status === "created") return <span className="inline-flex items-center gap-1 font-semibold text-green-700"><CheckCircle2 size={14} />Created</span>;
  if (status === "rolled_back") return <span className="font-semibold text-amber-700">Rolled back</span>;
  if (status === "rollback_failed") return <span className="font-semibold text-red-700">Review required</span>;
  if (status === "failed" || !valid) return <span className="inline-flex items-center gap-1 font-semibold text-red-700"><XCircle size={14} />Invalid</span>;
  return <span className="inline-flex items-center gap-1 font-semibold text-green-700"><CheckCircle2 size={14} />Valid</span>;
}

export function BulkUserImport({ configured }: { configured: boolean }) {
  const [displayed, action, pending] = useActionState(manageBulkUserImport, initialBulkUserImportState);
  return <section className="card mt-8 p-5 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-green-50 text-brand"><FileSpreadsheet size={19} /></span><div><h2 className="font-bold">Bulk import users</h2><p className="mt-1 text-sm text-black/50">Validate a CSV or XLSX file before creating any accounts.</p></div></div>
      <span className="rounded-full bg-black/[.04] px-3 py-1 text-xs font-bold text-black/55">Up to 50 users · 1 MB</span>
    </div>
    <div className="mt-5 rounded-xl border border-black/10 bg-black/[.02] p-4 text-sm leading-6 text-black/60"><p><b>Required headers:</b> full_name, email, role, password</p><p>Roles must be <b>student</b> or <b>teacher</b>. Passwords need 12+ characters with uppercase, lowercase, a number, and a symbol.</p></div>
    <form action={action} className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end">
      <input type="hidden" name="intent" value="preview" />
      <label className="min-w-0 flex-1"><span className="label">CSV or Excel file</span><input className="field file:mr-3 file:rounded-lg file:border-0 file:bg-black/[.06] file:px-3 file:py-2 file:font-semibold" name="userFile" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required disabled={!configured || pending} /></label>
      <button className="btn-secondary shrink-0" disabled={!configured || pending}><Upload size={17} />{pending ? "Working…" : "Validate and preview"}</button>
    </form>
    {displayed.message && <p className={`mt-5 rounded-xl border p-4 text-sm font-semibold ${displayed.ok ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-700"}`} role={displayed.ok ? "status" : "alert"}>{displayed.message}</p>}
    {displayed.rows.length > 0 && <div className="mt-5 overflow-x-auto rounded-xl border border-black/10"><table className="min-w-full text-left text-sm"><thead className="bg-black/[.035] text-xs uppercase tracking-wide text-black/45"><tr><th className="px-4 py-3">Row</th><th className="px-4 py-3">Name</th><th className="px-4 py-3">Email</th><th className="px-4 py-3">Role</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Details</th></tr></thead><tbody>{displayed.rows.map((row) => <tr className="border-t border-black/10 align-top" key={row.rowNumber}><td className="px-4 py-3 font-mono text-xs">{row.rowNumber}</td><td className="px-4 py-3 font-semibold">{row.fullName || "—"}</td><td className="px-4 py-3">{row.email || "—"}</td><td className="px-4 py-3 capitalize">{row.role || "—"}</td><td className="px-4 py-3"><RowStatus valid={row.errors.length === 0} status={row.status} /></td><td className="max-w-sm px-4 py-3 text-xs leading-5 text-red-700">{row.errors.join(" ") || (row.passwordValid ? "Password meets policy." : "Password does not meet policy.")}</td></tr>)}</tbody></table></div>}
    {displayed.ok && displayed.token && displayed.phase !== "complete" && <div className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-green-200 bg-green-50 p-4"><p className="flex items-start gap-2 text-sm leading-6 text-green-900"><ShieldCheck className="mt-0.5 shrink-0" size={17} />The file passed full validation. Existing accounts are checked again immediately before import.</p><form action={action}><input type="hidden" name="intent" value="import" /><input type="hidden" name="importToken" value={displayed.token} /><button className="btn-primary" disabled={pending}>{pending ? "Creating accounts…" : `Import ${displayed.rows.length} users`}</button></form></div>}
    <p className="mt-4 text-xs leading-5 text-black/45">Passwords are encrypted between preview and confirmation, sent only to the server-side Supabase Admin API, and never stored in import or audit records.</p>
  </section>;
}
