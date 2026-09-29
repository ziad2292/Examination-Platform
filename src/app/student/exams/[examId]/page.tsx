import { notFound, redirect } from "next/navigation";
import { CalendarClock, Clock3, ShieldCheck } from "lucide-react";
import { startExam } from "@/app/actions/attempts";
import { formatAppDateTime } from "@/lib/date-time";
import { getExamAvailability } from "@/lib/exam-state";
import { createClient } from "@/lib/supabase/server";

export default async function ExamEntry({ params, searchParams }: { params: Promise<{ examId: string }>; searchParams: Promise<{ error?: string }> }) {
  const { examId } = await params;
  const { error } = await searchParams;
  const supabase = await createClient();
  const { data: exam } = await supabase.from("exams").select("*,exam_sections(id,section_type,duration_seconds)").eq("id", examId).single();
  if (!exam) notFound();
  const [{ data: attempt }, { data: grant }] = await Promise.all([
    supabase.from("exam_attempts").select("id,generation,status,raw_score,total_questions").eq("exam_id", examId).order("generation", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("exam_retake_grants").select("id").eq("exam_id", examId).is("consumed_at", null).maybeSingle(),
  ]);
  if (attempt?.status === "in_progress") redirect(`/student/attempts/${attempt.id}`);
  const availability = getExamAvailability(exam.scheduled_start_at, exam.scheduled_end_at);
  const modules = exam.exam_sections.filter((section: { section_type: string }) => section.section_type === "module").length;
  const totalMinutes = exam.exam_sections.reduce((total: number, section: { duration_seconds: number }) => total + section.duration_seconds, 0) / 60;
  const terminalWithoutRetake = attempt && attempt.status !== "in_progress" && !grant;
  return <div className="mx-auto max-w-3xl"><p className="eyebrow">Exam overview</p><h1 className="mt-2 text-4xl font-bold">{exam.title}</h1><p className="mt-4 text-lg leading-8 text-black/60">{exam.description || "Read each question carefully and manage your time within each module."}</p>{exam.instructions && <section className="mt-6 rounded-xl border border-black/10 bg-white p-5"><h2 className="font-bold">Instructions</h2><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-black/60">{exam.instructions}</p></section>}<div className="card mt-8 grid gap-6 p-6 sm:grid-cols-3"><div><CalendarClock className="text-brand" /><p className="mt-2 text-xs font-bold uppercase text-black/40">Window</p><p className="mt-1 text-sm font-semibold">{formatAppDateTime(exam.scheduled_start_at)}<br />to {formatAppDateTime(exam.scheduled_end_at)}</p></div><div><Clock3 className="text-brand" /><p className="mt-2 text-xs font-bold uppercase text-black/40">Planned time</p><p className="mt-1 font-semibold">{totalMinutes} minutes</p></div><div><ShieldCheck className="text-brand" /><p className="mt-2 text-xs font-bold uppercase text-black/40">Format</p><p className="mt-1 font-semibold">{modules} timed modules</p></div></div>{error && <p role="alert" className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">We couldn’t start the exam. Check the schedule, access code, or retake authorization.</p>}{terminalWithoutRetake ? <div className="mt-8 rounded-2xl bg-green-50 p-6 text-center"><h2 className="text-xl font-bold text-brand">Attempt {attempt.generation} is {attempt.status}</h2><p className="mt-2 text-black/55">Your responses remain preserved. Ask your teacher if a retake is required.</p></div> : <div className="mt-8"><p className="text-sm leading-6 text-black/55">{grant ? "Your teacher authorized one new attempt generation. " : ""}Once a module starts, its timer cannot be paused. You cannot return after submitting it.</p><form action={startExam} className="stack-form mt-6 max-w-sm"><input type="hidden" name="examId" value={examId} />{exam.access_code_required && <label><span className="label">Exam access code</span><input className="field uppercase" name="accessCode" required autoComplete="off" /></label>}<button className="btn-primary w-full" disabled={availability !== "open"}>{availability === "not_started" ? "This exam has not started yet" : availability === "closed" ? "This exam is closed" : grant ? "Start authorized retake" : "Start exam"}</button></form></div>}</div>;
}
