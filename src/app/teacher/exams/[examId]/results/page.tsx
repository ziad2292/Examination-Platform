import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { formatAppDateTime } from "@/lib/date-time";
import { percent } from "@/lib/exam-state";
import { createClient } from "@/lib/supabase/server";

type Attempt = { id: string; generation: number; status: string; started_at: string; completed_at: string | null; raw_score: number | null; total_questions: number | null; profiles: { full_name: string; email: string } | { full_name: string; email: string }[] };

export default async function Results({ params }: { params: Promise<{ examId: string }> }) {
  await requireRole("teacher");
  const { examId } = await params;
  const supabase = await createClient();
  const { data: exam } = await supabase.from("exams").select("title").eq("id", examId).single();
  if (!exam) notFound();
  const { data } = await supabase.from("exam_attempts").select("id,generation,status,started_at,completed_at,raw_score,total_questions,profiles!exam_attempts_student_id_fkey(full_name,email)").eq("exam_id", examId).order("started_at");
  const attempts = (data ?? []) as unknown as Attempt[];
  return <div><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="eyebrow">Results and historical attempts</p><h1 className="mt-2 text-3xl font-bold tracking-tight">{exam.title}</h1><p className="mt-2 text-black/50">{attempts.length} preserved attempt{attempts.length === 1 ? "" : "s"}, including retake generations</p></div><Link className="btn-secondary" href={`/teacher/exams/${examId}/monitor`}>Live monitor</Link></div><div className="card mt-8 overflow-x-auto"><table className="w-full min-w-[860px] text-left text-sm"><thead className="border-b border-black/10 bg-black/[.025] text-xs uppercase tracking-wider text-black/45"><tr>{["Student", "Generation", "Status", "Started", "Completed", "Score", "Percent", ""].map((heading) => <th className="px-5 py-4" key={heading}>{heading}</th>)}</tr></thead><tbody>{attempts.map((attempt) => { const profile = Array.isArray(attempt.profiles) ? attempt.profiles[0] : attempt.profiles; return <tr className="border-b border-black/5 last:border-0" key={attempt.id}><td className="px-5 py-4"><b>{profile?.full_name}</b><br /><span className="text-black/45">{profile?.email}</span></td><td className="px-5 py-4">{attempt.generation}</td><td className="px-5 py-4 capitalize">{attempt.status.replace("_", " ")}</td><td className="px-5 py-4">{formatAppDateTime(attempt.started_at)}</td><td className="px-5 py-4">{formatAppDateTime(attempt.completed_at)}</td><td className="px-5 py-4 font-bold">{attempt.raw_score ?? "—"} / {attempt.total_questions ?? "—"}</td><td className="px-5 py-4">{attempt.raw_score != null && attempt.total_questions != null ? `${percent(attempt.raw_score, attempt.total_questions)}%` : "—"}</td><td className="px-5 py-4"><Link className="font-semibold text-brand" href={`/teacher/attempts/${attempt.id}`}>Review →</Link></td></tr>; })}{attempts.length === 0 && <tr><td className="px-5 py-12 text-center text-black/45" colSpan={8}>No students have started this exam.</td></tr>}</tbody></table></div></div>;
}
