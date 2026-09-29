import Link from "next/link";
import { Archive, ArrowRight, BarChart3, CalendarClock, Copy, Plus, Radio, Search } from "lucide-react";
import { archiveExam, deleteExam, duplicateExam, restoreExam } from "@/app/actions/exam-administration";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { requireRole } from "@/lib/auth";
import { formatAppDateTime } from "@/lib/date-time";
import { normalizeExamFilters } from "@/lib/exam-admin";
import { createClient } from "@/lib/supabase/server";
import type { ExamStatus } from "@/lib/types";

type ExamRow = {
  id: string;
  title: string;
  description: string | null;
  status: ExamStatus;
  scheduled_start_at: string;
  scheduled_end_at: string;
  created_at: string;
};

const badge: Record<ExamStatus, string> = {
  draft: "bg-slate-100 text-slate-700",
  published: "bg-green-100 text-green-800",
  closed: "bg-amber-100 text-amber-800",
  archived: "bg-zinc-100 text-zinc-600",
};

export default async function TeacherDashboard({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    phase?: string;
    from?: string;
    to?: string;
    notice?: string;
  }>;
}) {
  await requireRole("teacher");
  const filters = await searchParams;
  const { titleSearch, status, phase, dateFrom, dateTo } = normalizeExamFilters(filters);
  const now = new Date().toISOString();
  const supabase = await createClient();
  let query = supabase
    .from("exams")
    .select("id,title,description,status,scheduled_start_at,scheduled_end_at,created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (titleSearch) query = query.ilike("title", `%${titleSearch.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`);
  if (status) query = query.eq("status", status);
  else query = query.neq("status", "archived");
  if (dateFrom) query = query.gte("scheduled_start_at", `${dateFrom}T00:00:00.000Z`);
  if (dateTo) query = query.lte("scheduled_end_at", `${dateTo}T23:59:59.999Z`);
  if (phase === "upcoming") query = query.eq("status", "published").gt("scheduled_start_at", now);
  if (phase === "active") query = query.eq("status", "published").lte("scheduled_start_at", now).gt("scheduled_end_at", now);
  if (phase === "closed") query = query.or(`status.eq.closed,scheduled_end_at.lte.${now}`);

  const { data, error } = await query;
  if (error) throw new Error("Exams could not be loaded.");
  const exams = (data ?? []) as ExamRow[];
  const { data: countRows } = exams.length
    ? await supabase.rpc("teacher_exam_attempt_counts", { target_exams: exams.map((exam) => exam.id) })
    : { data: [] };
  const attemptCounts = new Map(
    ((countRows ?? []) as { exam_id: string; total_attempts: number; active_attempts: number }[]).map((row) => [row.exam_id, row]),
  );

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="eyebrow">Teacher workspace</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Exam operations</h1>
          <p className="mt-2 text-black/55">Build, schedule, monitor, and preserve every exam lifecycle.</p>
        </div>
        <Link className="btn-primary" href="/teacher/exams/new"><Plus size={18} />New exam</Link>
      </div>

      {filters.notice && (
        <p role="status" className="mt-6 rounded-xl border border-green-200 bg-green-50 p-4 text-sm font-semibold text-green-800">
          Exam operation completed successfully.
        </p>
      )}

      <form className="card mt-8 grid gap-4 p-5 lg:grid-cols-[1.5fr_repeat(4,1fr)_auto]" method="get">
        <label><span className="label">Title search</span><input className="field" name="q" defaultValue={titleSearch} placeholder="Search exams" /></label>
        <label><span className="label">Status</span><select className="field" name="status" defaultValue={status}><option value="">Active list</option><option value="draft">Draft</option><option value="published">Published</option><option value="closed">Closed</option><option value="archived">Archived</option></select></label>
        <label><span className="label">Timing</span><select className="field" name="phase" defaultValue={phase}><option value="">Any timing</option><option value="upcoming">Upcoming</option><option value="active">Active now</option><option value="closed">Closed</option></select></label>
        <label><span className="label">From</span><input className="field" type="date" name="from" defaultValue={dateFrom} /></label>
        <label><span className="label">To</span><input className="field" type="date" name="to" defaultValue={dateTo} /></label>
        <button className="btn-secondary self-end" type="submit"><Search size={17} />Filter</button>
      </form>

      {exams.length === 0 ? (
        <div className="card mt-8 grid place-items-center px-6 py-20 text-center">
          <CalendarClock className="text-brand" size={36} />
          <h2 className="mt-4 text-xl font-bold">No exams match these filters</h2>
          <p className="mt-2 max-w-md text-black/55">Adjust the filters or create a new mock exam.</p>
        </div>
      ) : (
        <div className="mt-8 grid gap-4">
          {exams.map((exam) => {
            const counts = attemptCounts.get(exam.id) ?? { total_attempts: 0, active_attempts: 0 };
            const hasAttempts = Number(counts.total_attempts) > 0;
            const hasActiveAttempts = Number(counts.active_attempts) > 0;
            const duplicateId = crypto.randomUUID();
            const duplicateKey = crypto.randomUUID();
            return (
              <article className="card flex flex-col gap-5 p-5 xl:flex-row xl:items-center xl:justify-between" key={exam.id}>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-3">
                    <h2 className="text-lg font-bold">{exam.title}</h2>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-bold capitalize ${badge[exam.status]}`}>{exam.status}</span>
                    {hasActiveAttempts && <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700">{counts.active_attempts} active</span>}
                  </div>
                  <p className="mt-2 flex items-start gap-2 text-sm leading-6 text-black/50"><CalendarClock className="mt-0.5 shrink-0" size={15} /><span>{formatAppDateTime(exam.scheduled_start_at)} — {formatAppDateTime(exam.scheduled_end_at)}</span></p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Link className="btn-secondary !min-h-10 !px-4" href={`/teacher/exams/${exam.id}/monitor`}><Radio size={16} />Monitor</Link>
                  <Link className="btn-secondary !min-h-10 !px-4" href={`/teacher/exams/${exam.id}/results`}><BarChart3 size={16} />Results</Link>
                  <Link className="btn-secondary !min-h-10 !px-4" href={`/teacher/exams/${exam.id}`}>Manage<ArrowRight size={16} /></Link>
                  <details className="relative">
                    <summary className="btn-ghost cursor-pointer list-none">More</summary>
                    <div className="absolute right-0 z-20 mt-2 w-72 space-y-3 rounded-xl border border-black/10 bg-white p-4 shadow-xl">
                      <form action={duplicateExam}>
                        <input type="hidden" name="examId" value={exam.id} /><input type="hidden" name="targetExamId" value={duplicateId} /><input type="hidden" name="operationKey" value={duplicateKey} /><input type="hidden" name="newTitle" value={`${exam.title} (Copy)`} />
                        <ConfirmSubmitButton className="btn-secondary w-full" label="Duplicate exam" pendingLabel="Duplicating…" confirmation={`Duplicate “${exam.title}”? The copy will be a new draft with a fresh schedule and no attempts.`} />
                      </form>
                      {exam.status === "archived" ? (
                        <form action={restoreExam}>
                          <input type="hidden" name="examId" value={exam.id} /><input type="hidden" name="operationKey" value={crypto.randomUUID()} /><input type="hidden" name="reason" value="Restored from archived exam list" />
                          <ConfirmSubmitButton className="btn-secondary w-full" label="Restore exam" confirmation={`Restore “${exam.title}”? It will return as ${hasAttempts ? "closed" : "a draft"}.`} />
                        </form>
                      ) : hasActiveAttempts ? (
                        <div><button className="btn-secondary w-full" type="button" disabled>Archive unavailable</button><p className="mt-2 text-xs leading-5 text-amber-700">Active attempts must finish or be administered before this exam can be archived.</p></div>
                      ) : (
                        <form action={archiveExam}>
                          <input type="hidden" name="examId" value={exam.id} /><input type="hidden" name="operationKey" value={crypto.randomUUID()} /><input type="hidden" name="reason" value="Archived from teacher dashboard" />
                          <ConfirmSubmitButton className="btn-secondary w-full" label="Archive exam" confirmation={hasActiveAttempts ? `“${exam.title}” has active attempts and cannot be archived.` : `Archive “${exam.title}”? It will leave active lists and become read-only while results remain available.`} />
                        </form>
                      )}
                      {exam.status === "draft" && !hasAttempts && (
                        <form action={deleteExam}>
                          <input type="hidden" name="examId" value={exam.id} /><input type="hidden" name="confirmationTitle" value={exam.title} /><input type="hidden" name="operationKey" value={crypto.randomUUID()} /><input type="hidden" name="reason" value="Permanently deleted untouched draft" />
                          <ConfirmSubmitButton className="btn-danger w-full" label="Delete draft" confirmation={`Permanently delete “${exam.title}”? Its questions and queued Storage images will be removed. This cannot be undone.`} requiredText={exam.title} />
                        </form>
                      )}
                      {hasAttempts && <p className="text-xs leading-5 text-black/45"><Archive className="mr-1 inline" size={13} />Exams with attempts can only be archived; historical attempts are preserved.</p>}
                      {!hasAttempts && <p className="text-xs leading-5 text-black/45"><Copy className="mr-1 inline" size={13} />Copies never include attempts, answers, or results.</p>}
                    </div>
                  </details>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
