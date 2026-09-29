import Link from "next/link";
import { notFound } from "next/navigation";
import { authorizeRetake, correctAnswerKey, resetAttempt, teacherSubmitAttempt, teacherSubmitSection } from "@/app/actions/exam-administration";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { requireRole } from "@/lib/auth";
import { formatAppDateTime } from "@/lib/date-time";
import { createClient } from "@/lib/supabase/server";

type Question = {
  id: string;
  question_order: number;
  optional_text: string | null;
  exam_sections: { title: string; section_order: number };
  question_keys: { correct_option: string } | { correct_option: string }[];
};
type Answer = { question_id: string; selected_option: string | null; marked_for_review: boolean; answer_results: { is_correct: boolean } | { is_correct: boolean }[] | null };
type SectionAttempt = { id: string; status: string; started_at: string; expires_at: string; submitted_at: string | null; exam_sections: { title: string; section_order: number } | { title: string; section_order: number }[] };

export default async function AttemptDetail({
  params,
  searchParams,
}: {
  params: Promise<{ attemptId: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  await requireRole("teacher");
  const { attemptId } = await params;
  const feedback = await searchParams;
  const supabase = await createClient();
  const { data: attempt } = await supabase.from("exam_attempts").select("*,profiles!exam_attempts_student_id_fkey(full_name,email),exams(id,title)").eq("id", attemptId).single();
  if (!attempt) notFound();
  const exam = Array.isArray(attempt.exams) ? attempt.exams[0] : attempt.exams;
  const [{ data: questionData }, { data: answerData }, { data: sectionData }, { data: grant }] = await Promise.all([
    supabase.from("questions").select("id,question_order,optional_text,exam_sections!inner(title,section_order,exam_id),question_keys(correct_option)").eq("exam_sections.exam_id", exam.id),
    supabase.from("answers").select("question_id,selected_option,marked_for_review,answer_results(is_correct)").eq("exam_attempt_id", attemptId),
    supabase.from("section_attempts").select("id,status,started_at,expires_at,submitted_at,exam_sections(title,section_order)").eq("exam_attempt_id", attemptId),
    supabase.from("exam_retake_grants").select("id,reason,created_at").eq("exam_id", exam.id).eq("student_id", attempt.student_id).is("consumed_at", null).maybeSingle(),
  ]);
  const questions = ((questionData ?? []) as unknown as Question[]).sort((left, right) => left.exam_sections.section_order - right.exam_sections.section_order || left.question_order - right.question_order);
  const answers = (answerData ?? []) as unknown as Answer[];
  const byQuestion = new Map(answers.map((answer) => [answer.question_id, answer]));
  const sections = ((sectionData ?? []) as unknown as SectionAttempt[]).sort((left, right) => {
    const leftSection = Array.isArray(left.exam_sections) ? left.exam_sections[0] : left.exam_sections;
    const rightSection = Array.isArray(right.exam_sections) ? right.exam_sections[0] : right.exam_sections;
    return leftSection.section_order - rightSection.section_order;
  });
  const profile = Array.isArray(attempt.profiles) ? attempt.profiles[0] : attempt.profiles;
  const studentName = profile.full_name;

  return <div>
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="eyebrow">Attempt administration · generation {attempt.generation}</p><h1 className="mt-2 text-3xl font-bold">{studentName} · {exam.title}</h1><p className="mt-2 text-black/50">Status: <b className="capitalize">{attempt.status}</b> · Started {formatAppDateTime(attempt.started_at)} · Score {attempt.raw_score ?? "Pending"} / {attempt.total_questions ?? questions.length}</p></div><div className="flex gap-2"><Link className="btn-secondary" href={`/teacher/exams/${exam.id}/monitor`}>Live monitor</Link><Link className="btn-secondary" href={`/teacher/exams/${exam.id}/results`}>All results</Link></div></div>
    {feedback.notice && <p role="status" className="mt-6 rounded-xl border border-green-200 bg-green-50 p-4 text-sm font-semibold text-green-800">The administrative action completed and was added to the audit history.</p>}
    {feedback.error && <p role="alert" className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">The action was rejected. The attempt may have changed or the lifecycle policy does not allow it.</p>}

    <div className="mt-8 grid gap-6 xl:grid-cols-[1fr_360px]">
      <div className="space-y-3">
        {questions.map((question) => {
          const answer = byQuestion.get(question.id);
          const result = answer ? (Array.isArray(answer.answer_results) ? answer.answer_results[0] : answer.answer_results) : null;
          const key = Array.isArray(question.question_keys) ? question.question_keys[0] : question.question_keys;
          return <article className="card p-5" key={question.id}>
            <div className="flex flex-wrap items-center gap-4"><div className="min-w-0 flex-1"><p className="text-xs font-bold uppercase text-black/40">{question.exam_sections.title} · Question {question.question_order}</p><p className="mt-1 truncate font-medium">{question.optional_text || "Image-based question"}</p></div><span className="text-sm">Selected: <b>{answer?.selected_option ?? "Unanswered"}</b></span><span className="text-sm">Correct: <b>{key?.correct_option}</b></span>{answer?.marked_for_review && <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-bold">Marked</span>}<span className={`rounded-full px-3 py-1 text-xs font-bold ${result?.is_correct ? "bg-green-100 text-green-800" : "bg-red-100 text-red-700"}`}>{result?.is_correct ? "Correct" : answer?.selected_option ? "Incorrect" : "Unanswered"}</span></div>
            <details className="mt-4 rounded-xl border border-dashed border-black/15 p-4"><summary className="cursor-pointer text-sm font-semibold text-brand">Correct answer key and regrade</summary><form action={correctAnswerKey} className="stack-form mt-4"><input type="hidden" name="attemptId" value={attemptId} /><input type="hidden" name="examId" value={exam.id} /><input type="hidden" name="questionId" value={question.id} /><input type="hidden" name="operationKey" value={crypto.randomUUID()} /><label><span className="label">Corrected option</span><select className="field" name="correctedOption" defaultValue={key?.correct_option}>{["A", "B", "C", "D"].map((option) => <option key={option}>{option}</option>)}</select></label><label><span className="label">Correction reason</span><input className="field" name="reason" minLength={3} maxLength={1000} required placeholder="Explain the answer-key error" /></label><ConfirmSubmitButton className="btn-danger" label="Correct key and regrade" confirmation={`Correct the answer key for question ${question.question_order}? Every terminal attempt for this exam will be deterministically regraded and the old key will remain in audit history.`} /></form></details>
          </article>;
        })}
      </div>

      <aside className="space-y-5">
        <section className="card p-5"><h2 className="font-bold">Section activity</h2><ol className="mt-4 space-y-4">{sections.map((section) => { const detail = Array.isArray(section.exam_sections) ? section.exam_sections[0] : section.exam_sections; return <li className="rounded-xl bg-black/[.025] p-3" key={section.id}><div className="flex items-center justify-between gap-2"><b className="text-sm">{detail.title}</b><span className="text-xs font-bold uppercase text-black/45">{section.status}</span></div><p className="mt-1 text-xs text-black/45">Started {formatAppDateTime(section.started_at)}<br />Expires {formatAppDateTime(section.expires_at)}</p>{section.status === "in_progress" && attempt.status === "in_progress" && <form action={teacherSubmitSection} className="mt-3"><input type="hidden" name="attemptId" value={attemptId} /><input type="hidden" name="examId" value={exam.id} /><input type="hidden" name="sectionAttemptId" value={section.id} /><input type="hidden" name="operationKey" value={crypto.randomUUID()} /><input type="hidden" name="reason" value="Teacher manually submitted active section" /><ConfirmSubmitButton className="btn-secondary w-full" label="Submit this section" confirmation={`Submit ${studentName}’s active section “${detail.title}”? Future answers in this section will be locked. This action is idempotent and audited.`} /></form>}</li>; })}{sections.length === 0 && <li className="text-sm text-black/45">No section has started.</li>}</ol></section>

        <section className="card p-5"><h2 className="font-bold">Attempt controls</h2><p className="mt-2 text-sm leading-6 text-black/50">Historical attempts are never deleted or reopened in place. Reset and retake actions create a controlled grant for a new generation.</p><div className="mt-4 space-y-4">
          {attempt.status === "in_progress" && <><form action={teacherSubmitAttempt} className="stack-form"><input type="hidden" name="attemptId" value={attemptId} /><input type="hidden" name="examId" value={exam.id} /><input type="hidden" name="operationKey" value={crypto.randomUUID()} /><label><span className="label">Submission reason</span><input className="field" name="reason" minLength={3} maxLength={1000} required placeholder="Why this attempt must be submitted" /></label><ConfirmSubmitButton className="btn-secondary w-full" label="Submit entire attempt" confirmation={`Submit ${studentName}’s entire active attempt? All active sections will close, future answers will be locked, and current answers will be graded.`} /></form><form action={resetAttempt} className="stack-form border-t border-black/10 pt-4"><input type="hidden" name="attemptId" value={attemptId} /><input type="hidden" name="examId" value={exam.id} /><input type="hidden" name="operationKey" value={crypto.randomUUID()} /><label><span className="label">Reset reason</span><input className="field" name="reason" minLength={3} maxLength={1000} required placeholder="Document the reset decision" /></label><ConfirmSubmitButton className="btn-danger w-full" label="Reset and permit retake" confirmation={`Reset ${studentName}’s attempt? This attempt will be closed and preserved in history, then ${studentName} will be allowed to start a new generation.`} /></form></>}
          {attempt.status !== "in_progress" && !grant && <form action={authorizeRetake} className="stack-form"><input type="hidden" name="attemptId" value={attemptId} /><input type="hidden" name="examId" value={exam.id} /><input type="hidden" name="operationKey" value={crypto.randomUUID()} /><label><span className="label">Retake reason</span><input className="field" name="reason" minLength={3} maxLength={1000} required placeholder="Document why a retake is allowed" /></label><ConfirmSubmitButton className="btn-secondary w-full" label="Enable retake" confirmation={`Enable a retake for ${studentName}? This attempt remains unchanged in history and a new attempt generation will be created when the student starts again.`} /></form>}
          {grant && <div className="rounded-xl bg-green-50 p-4 text-sm text-green-800"><b>Retake authorized</b><br />The next valid start will consume this one-time grant.</div>}
        </div></section>
      </aside>
    </div>
  </div>;
}
