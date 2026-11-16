import Link from "next/link";
import { reviewRegistration } from "@/app/actions/registration";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatAppDateTime } from "@/lib/date-time";

export default async function Approvals({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string; notice?: string }>;
}) {
  await requireRole("superadmin");
  const params = await searchParams;
  const status =
    params.status === "approved" || params.status === "rejected"
      ? params.status
      : "pending";
  const page = Math.min(
    10000,
    Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1),
  );
  const db = await createClient();
  const { data, error, count } = await db
    .from("profiles")
    .select("id,full_name,email,created_at", { count: "exact" })
    .eq("role", "student")
    .eq("approval_status", status)
    .not("self_registered_at", "is", null)
    .order("created_at", { ascending: false })
    .order("id")
    .range((page - 1) * 20, page * 20 - 1);
  if (error) throw new Error("Registration requests could not be loaded.");
  const { data: emailChecks, error: emailError } = data?.length
    ? await db.rpc("registration_email_checks", {
        students: data.map((student) => student.id),
      })
    : { data: [], error: null };
  if (emailError)
    throw new Error("Email verification status could not be loaded.");
  const verified = new Set(
    (emailChecks as { id: string; verified: boolean }[])
      .filter((row) => row.verified)
      .map((row) => row.id),
  );
  return (
    <div>
      <p className="eyebrow">Student access</p>
      <h1 className="mt-2 font-bold">Pending approvals</h1>
      <p className="mt-3 text-sm text-black/60">
        Review student registration requests. Students must verify their email
        before approval.
      </p>
      {params.notice && (
        <p className="mt-5 rounded-lg bg-amber-50 p-4 text-sm" role="status">
          {params.notice === "saved"
            ? "Registration decision saved."
            : "The decision could not be saved. Check that the student's email is verified."}
        </p>
      )}
      <nav
        aria-label="Registration status"
        className="my-6 flex flex-wrap gap-2"
      >
        {["pending", "approved", "rejected"].map((value) => (
          <Link
            key={value}
            href={`?status=${value}`}
            aria-current={status === value ? "page" : undefined}
            className={`${status === value ? "btn-primary" : "btn-secondary"} capitalize`}
          >
            {value}
          </Link>
        ))}
      </nav>
      <div className="grid gap-3">
        {data?.map((student) => (
          <article
            key={student.id}
            className="card flex flex-wrap items-center justify-between gap-4 p-5"
          >
            <div className="min-w-0">
              <h2 className="font-semibold">{student.full_name}</h2>
              <p className="break-all text-sm text-black/60">{student.email}</p>
              <p className="mt-2 text-xs text-black/55">
                {formatAppDateTime(student.created_at)} · {status} ·{" "}
                {verified.has(student.id)
                  ? "Email verified"
                  : "Email unverified"}
              </p>
            </div>
            {status === "pending" && (
              <form
                action={reviewRegistration}
                className="flex flex-wrap items-end gap-3"
              >
                <input type="hidden" name="student" value={student.id} />
                <label>
                  <span className="label">Rejection note (optional)</span>
                  <input className="field" name="note" maxLength={1000} />
                </label>
                <PendingSubmitButton
                  name="decision"
                  value="approve"
                  disabled={!verified.has(student.id)}
                  pendingLabel="Saving…"
                >
                  Approve
                </PendingSubmitButton>
                <PendingSubmitButton
                  name="decision"
                  value="reject"
                  className="btn-danger"
                  pendingLabel="Saving…"
                >
                  Reject
                </PendingSubmitButton>
              </form>
            )}
          </article>
        ))}
      </div>
      {!data?.length && (
        <p className="card p-8 text-center text-sm text-black/60">
          No {status} requests on this page.
        </p>
      )}
      <div className="mt-5 flex gap-3">
        {page > 1 && (
          <Link
            className="btn-secondary"
            href={`?status=${status}&page=${page - 1}`}
          >
            Previous
          </Link>
        )}
        {(count ?? 0) > page * 20 && (
          <Link
            className="btn-secondary"
            href={`?status=${status}&page=${page + 1}`}
          >
            Next
          </Link>
        )}
      </div>
    </div>
  );
}
