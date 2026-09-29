import Link from "next/link";
import { notFound } from "next/navigation";
import { Activity, CheckCircle2, Clock3, Users, XCircle } from "lucide-react";
import { PollingRefresh } from "@/components/polling-refresh";
import { requireRole } from "@/lib/auth";
import { formatAppDateTime } from "@/lib/date-time";
import { latestAttemptsByStudent, summarizeLiveStatus } from "@/lib/exam-admin";
import { createClient } from "@/lib/supabase/server";

type SectionAttemptRow = {
  id: string;
  status: string;
  started_at: string;
  expires_at: string;
  submitted_at: string | null;
  exam_sections: { title: string; section_order: number } | { title: string; section_order: number }[];
};
type AttemptRow = {
  id: string;
  student_id: string;
  status: "in_progress" | "completed" | "expired";
  generation: number;
  started_at: string;
  last_seen_at: string;
  completed_at: string | null;
  raw_score: number | null;
  total_questions: number | null;
  profiles: { full_name: string } | { full_name: string }[];
  section_attempts: SectionAttemptRow[];
};

export default async function ExamMonitor({ params }: { params: Promise<{ examId: string }> }) {
  await requireRole("teacher");
  const { examId } = await params;
  const supabase = await createClient();
  const [{ data: exam }, { data: attemptData }, { count: studentCount }] = await Promise.all([
    supabase.from("exams").select("id,title,status,scheduled_start_at,scheduled_end_at").eq("id", examId).single(),
    supabase.from("exam_attempts").select("id,student_id,status,generation,started_at,last_seen_at,completed_at,raw_score,total_questions,profiles!exam_attempts_student_id_fkey(full_name),section_attempts(id,status,started_at,expires_at,submitted_at,exam_sections(title,section_order))").eq("exam_id", examId).order("generation", { ascending: false }),
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "student"),
  ]);
  if (!exam) notFound();
  const attempts = latestAttemptsByStudent((attemptData ?? []) as unknown as AttemptRow[]);
  const counts = summarizeLiveStatus(studentCount ?? 0, attempts);

  return <div>
    <PollingRefresh intervalMs={15000} />
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="eyebrow">Live exam status</p><h1 className="mt-2 text-3xl font-bold">{exam.title}</h1><p className="mt-2 text-black/50">{formatAppDateTime(exam.scheduled_start_at)} — {formatAppDateTime(exam.scheduled_end_at)}</p></div><Link className="btn-secondary" href={`/teacher/exams/${examId}`}>Manage exam</Link></div>
    <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {[{ label: "Not started", value: counts.notStarted, icon: Users, tone: "bg-slate-50 text-slate-700" }, { label: "In progress", value: counts.inProgress, icon: Activity, tone: "bg-blue-50 text-blue-700" }, { label: "Completed", value: counts.completed, icon: CheckCircle2, tone: "bg-green-50 text-green-800" }, { label: "Expired / reset", value: counts.problem, icon: XCircle, tone: "bg-amber-50 text-amber-800" }].map((item) => <section className={`card p-5 ${item.tone}`} key={item.label}><item.icon size={21} /><p className="mt-3 text-3xl font-bold tabular-nums">{item.value}</p><p className="mt-1 text-sm font-semibold">{item.label}</p></section>)}
    </div>
    <div className="card mt-8 overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead className="border-b border-black/10 bg-black/[.025] text-xs uppercase tracking-wider text-black/45"><tr>{["Student", "Status", "Current module", "Attempt started", "Section started", "Last activity", "Completion", ""].map((heading) => <th className="px-5 py-4" key={heading}>{heading}</th>)}</tr></thead><tbody>{attempts.map((attempt) => {
      const profile = Array.isArray(attempt.profiles) ? attempt.profiles[0] : attempt.profiles;
      const orderedSections = [...(attempt.section_attempts ?? [])].sort((left, right) => {
        const leftSection = Array.isArray(left.exam_sections) ? left.exam_sections[0] : left.exam_sections;
        const rightSection = Array.isArray(right.exam_sections) ? right.exam_sections[0] : right.exam_sections;
        return (rightSection?.section_order ?? 0) - (leftSection?.section_order ?? 0);
      });
      const current = orderedSections.find((section) => section.status === "in_progress") ?? orderedSections[0];
      const currentSection = current ? (Array.isArray(current.exam_sections) ? current.exam_sections[0] : current.exam_sections) : null;
      return <tr className="border-b border-black/5 last:border-0" key={attempt.id}><td className="px-5 py-4"><b>{profile?.full_name ?? "Student"}</b><br /><span className="text-xs text-black/40">Attempt {attempt.generation}</span></td><td className="px-5 py-4 capitalize">{attempt.status.replaceAll("_", " ")}</td><td className="px-5 py-4">{currentSection?.title ?? "Not started"}</td><td className="px-5 py-4">{formatAppDateTime(attempt.started_at)}</td><td className="px-5 py-4">{current ? formatAppDateTime(current.started_at) : "—"}</td><td className="px-5 py-4"><span className="inline-flex items-center gap-1"><Clock3 size={14} />{formatAppDateTime(attempt.last_seen_at)}</span></td><td className="px-5 py-4">{formatAppDateTime(attempt.completed_at)}</td><td className="px-5 py-4"><Link className="font-semibold text-brand" href={`/teacher/attempts/${attempt.id}`}>Administer →</Link></td></tr>;
    })}{attempts.length === 0 && <tr><td className="px-5 py-12 text-center text-black/45" colSpan={8}>No student has started this exam.</td></tr>}</tbody></table></div>
    <p className="mt-4 text-xs leading-5 text-black/45">“Not started” is based on all registered student accounts because this MVP does not yet model per-exam enrollment.</p>
  </div>;
}
