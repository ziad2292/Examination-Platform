import { notFound, redirect } from "next/navigation";
import { CalendarClock, Clock3, ShieldCheck } from "lucide-react";
import { startExam } from "@/app/actions/attempts";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { formatAppDateTime } from "@/lib/date-time";
import { getExamAvailability } from "@/lib/exam-state";
import { createClient } from "@/lib/supabase/server";

export default async function ExamEntry({
  params,
  searchParams,
}: {
  params: Promise<{ examId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { examId } = await params;
  const { error } = await searchParams;
  const supabase = await createClient();
  const { data: exam } = await supabase
    .from("exams")
    .select("*,exam_sections(id,section_type,duration_seconds)")
    .eq("id", examId)
    .single();
  if (!exam) notFound();
  const { data: integrityPreview } =
    process.env.NEXT_PUBLIC_INTEGRITY_ENABLED === "true"
      ? await supabase.rpc("student_integrity_preview", { target_exam: examId })
      : { data: null };
  const monitoring = integrityPreview as null | {
    enabled: boolean;
    restrict_clipboard: boolean;
    threshold: number;
  };
  const [{ data: attemptData }, { data: grant }] = await Promise.all([
    supabase
      .rpc("student_exam_attempt_summary", { target_exam: examId })
      .maybeSingle(),
    supabase
      .from("exam_retake_grants")
      .select("id")
      .eq("exam_id", examId)
      .is("consumed_at", null)
      .maybeSingle(),
  ]);
  const attempt = attemptData as null | {
    id: string;
    generation: number;
    status: string;
    raw_score: number | null;
    total_questions: number | null;
    results_visible: boolean;
  };
  if (attempt?.status === "in_progress")
    redirect(`/student/attempts/${attempt.id}`);
  const availability = getExamAvailability(
    exam.scheduled_start_at,
    exam.scheduled_end_at,
  );
  const modules = exam.exam_sections.filter(
    (section: { section_type: string }) => section.section_type === "module",
  ).length;
  const totalMinutes =
    exam.exam_sections.reduce(
      (total: number, section: { duration_seconds: number }) =>
        total + section.duration_seconds,
      0,
    ) / 60;
  const terminalWithoutRetake =
    attempt && attempt.status !== "in_progress" && !grant;
  const errors: Record<string, string> = {
    not_started: "This exam has not started yet.",
    closed: "This exam is closed and no new attempts can begin.",
    invalid_code: "That access code is not valid for this exam.",
    retake_required:
      "You already completed this exam. Ask your teacher to authorize a retake.",
    unauthorized: "This account is not authorized to take student exams.",
    unassigned: "You are not assigned to this exam.",
    unavailable: "This exam is not available to students.",
    start_failed:
      "The exam could not be started. Please try again or contact your teacher.",
  };
  return (
    <div className="mx-auto max-w-3xl">
      {monitoring?.enabled && (
        <section className="card mb-6 p-5">
          <h2 className="font-bold">Monitored assessment</h2>
          <p className="mt-2 text-sm leading-6 text-black/55">
            This assessment records focus and tab visibility changes, supported
            clipboard restrictions, session overlaps, and connection status for
            teacher review. Browser activity is not proof of cheating. No
            camera, screen recording, clipboard contents, or browsing history
            are collected. A review flag never automatically changes your grade
            or submits your exam. Raw observations are kept according to the
            platform retention policy after completion.
          </p>
        </section>
      )}
      <p className="eyebrow">Exam overview</p>
      <h1 className="mt-2 text-4xl font-bold">{exam.title}</h1>
      <p className="mt-4 text-lg leading-8 text-black/60">
        {exam.description ||
          "Read each question carefully and manage your time within each module."}
      </p>
      {exam.instructions && (
        <section className="mt-6 rounded-xl border border-black/10 bg-white p-5">
          <h2 className="font-bold">Instructions</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-black/60">
            {exam.instructions}
          </p>
        </section>
      )}
      <div className="card mt-8 grid gap-6 p-6 sm:grid-cols-3">
        <div>
          <CalendarClock className="text-brand" />
          <p className="mt-2 text-xs font-bold uppercase text-black/40">
            Window
          </p>
          <p className="mt-1 text-sm font-semibold">
            {formatAppDateTime(exam.scheduled_start_at)}
            <br />
            to {formatAppDateTime(exam.scheduled_end_at)}
          </p>
        </div>
        <div>
          <Clock3 className="text-brand" />
          <p className="mt-2 text-xs font-bold uppercase text-black/40">
            Planned time
          </p>
          <p className="mt-1 font-semibold">{totalMinutes} minutes</p>
        </div>
        <div>
          <ShieldCheck className="text-brand" />
          <p className="mt-2 text-xs font-bold uppercase text-black/40">
            Format
          </p>
          <p className="mt-1 font-semibold">{modules} timed modules</p>
        </div>
      </div>
      {error && (
        <p
          role="alert"
          className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-red-700"
        >
          {errors[error] ?? errors.start_failed}
        </p>
      )}
      {terminalWithoutRetake ? (
        <div className="mt-8 rounded-2xl bg-green-50 p-6 text-center">
          <h2 className="text-xl font-bold text-brand">
            Attempt {attempt.generation} is {attempt.status}
          </h2>
          <p className="mt-2 text-black/55">
            {attempt.results_visible && attempt.raw_score !== null
              ? `Your score is ${attempt.raw_score} out of ${attempt.total_questions}.`
              : "Your marks are not available yet. Your teacher controls when results are released."}
          </p>
          <p className="mt-2 text-sm text-black/45">
            Your responses remain preserved. Ask your teacher if a retake is
            required.
          </p>
        </div>
      ) : (
        <div className="mt-8">
          <p className="text-sm leading-6 text-black/55">
            {grant
              ? "Your teacher authorized one new attempt generation. "
              : ""}
            Once a module starts, its timer cannot be paused. You cannot return
            after submitting it.
          </p>
          <form action={startExam} className="stack-form mt-6 max-w-sm">
            <input type="hidden" name="examId" value={examId} />
            {exam.access_code_required && (
              <label>
                <span className="label">Exam access code</span>
                <input
                  className="field uppercase"
                  name="accessCode"
                  required
                  autoComplete="off"
                />
              </label>
            )}
            <PendingSubmitButton
              className="btn-primary w-full"
              pendingLabel="Starting exam…"
              disabled={availability !== "open"}
            >
              {availability === "not_started"
                ? "This exam has not started yet"
                : availability === "closed"
                  ? "This exam is closed"
                  : grant
                    ? "Start authorized retake"
                    : "Start exam"}
            </PendingSubmitButton>
          </form>
        </div>
      )}
    </div>
  );
}
