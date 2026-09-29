import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BarChart3, ChevronDown, ChevronUp, Radio, Trash2 } from "lucide-react";
import {
  replaceQuestionImage,
  updateExamMetadata,
} from "@/app/actions/exam-administration";
import { deleteQuestion, moveBuilderItem } from "@/app/actions/exams";
import { BulkQuestionImport } from "@/components/bulk-question-import";
import { BuilderAccordionGroup, BuilderSectionAccordion } from "@/components/builder-section-accordion";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { ExamManagementActions } from "@/components/exam-management-actions";
import { ExamScheduleFields } from "@/components/exam-schedule-fields";
import { ManualQuestionForm } from "@/components/manual-question-form";
import { requireRole } from "@/lib/auth";
import { formatAppDateTime } from "@/lib/date-time";
import { createClient } from "@/lib/supabase/server";

type Question = {
  id: string;
  question_order: number;
  optional_text: string | null;
  image_path: string | null;
  image_url?: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  question_keys: { correct_option: string } | { correct_option: string }[];
  [key: string]: string | number | null | undefined | { correct_option: string } | { correct_option: string }[];
};
type Section = { id: string; title: string; section_type: "module" | "break"; section_order: number; duration_seconds: number; questions: Question[] };
type PublishValidation = { ready: boolean; errors: string[]; modules: number; breaks: number; questions: number; answerKeys: number; scheduleValid: boolean };
type AuditEvent = { id: string; action: string; reason: string | null; created_at: string; profiles: { full_name: string } | { full_name: string }[] };

function MoveButtons({ examId, kind, id }: { examId: string; kind: "section" | "question"; id: string }) {
  return <div className="flex shrink-0 gap-1">{([-1, 1] as const).map((direction) => <form action={moveBuilderItem} key={direction}>
    <input type="hidden" name="examId" value={examId} /><input type="hidden" name="kind" value={kind} /><input type="hidden" name="id" value={id} /><input type="hidden" name="direction" value={direction} />
    <button className="icon-button" title={`Move ${direction < 0 ? "up" : "down"}`} aria-label={`Move ${kind} ${direction < 0 ? "up" : "down"}`}>{direction < 0 ? <ChevronUp size={17} /> : <ChevronDown size={17} />}</button>
  </form>)}</div>;
}

export default async function ExamEditor({
  params,
  searchParams,
}: {
  params: Promise<{ examId: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const viewer = await requireRole("teacher");
  const { examId } = await params;
  const feedback = await searchParams;
  const supabase = await createClient();
  const { data: exam } = await supabase.from("exams").select("*").eq("id", examId).single();
  if (!exam) notFound();
  const [{ data }, { data: validationData }, { data: countRows }, { data: auditData }] = await Promise.all([
    supabase.from("exam_sections").select("id,title,section_type,section_order,duration_seconds,questions(id,question_order,optional_text,image_path,option_a,option_b,option_c,option_d,question_keys(correct_option))").eq("exam_id", examId).order("section_order").order("question_order", { referencedTable: "questions" }),
    supabase.rpc("exam_publish_validation", { target_exam: examId }),
    supabase.rpc("teacher_exam_attempt_counts", { target_exams: [examId] }),
    supabase.from("admin_audit_events").select("id,action,reason,created_at,profiles!admin_audit_events_actor_id_fkey(full_name)").eq("exam_id", examId).order("created_at", { ascending: false }).limit(8),
  ]);
  const sections = (data ?? []) as unknown as Section[];
  const validation = validationData as PublishValidation | null;
  const counts = ((countRows ?? [])[0] ?? { total_attempts: 0, active_attempts: 0 }) as { total_attempts: number; active_attempts: number };
  const attempts = Number(counts.total_attempts);
  const activeAttempts = Number(counts.active_attempts);
  const contentEditable = attempts === 0 && ["draft", "published"].includes(exam.status);
  const metadataEditable = exam.status !== "archived";
  const imagePaths = sections.flatMap((section) => section.questions.flatMap((question) => question.image_path ? [question.image_path] : []));
  const signedImages = imagePaths.length ? await supabase.storage.from("question-images").createSignedUrls(imagePaths, 3600) : { data: [] };
  const imageUrls = new Map((signedImages.data ?? []).map((image) => [image.path, image.signedUrl]));
  sections.forEach((section) => section.questions.forEach((question) => { if (question.image_path) question.image_url = imageUrls.get(question.image_path) ?? undefined; }));
  const auditEvents = (auditData ?? []) as unknown as AuditEvent[];
  // Server-rendered availability is intentionally evaluated at request time.
  // eslint-disable-next-line react-hooks/purity
  const requestTime = Date.now();
  const currentlyRunning = exam.status === "published" && requestTime >= new Date(exam.scheduled_start_at).getTime() && requestTime < new Date(exam.scheduled_end_at).getTime();
  const canDelete = attempts === 0 && !currentlyRunning;
  const deleteBlockedReason = attempts > 0 ? "Delete is unavailable because student attempt history must be preserved. Archive this exam instead." : currentlyRunning ? "Delete is unavailable while the exam window is active. Close the exam first." : null;
  const messages: Record<string, string> = {
    invalid_details: "Check the exam details and schedule.",
    update_failed: "Those details could not be saved. Reload if this exam changed in another tab.",
    publish_not_ready: "Complete the publish-readiness items before publishing.",
    publish_failed: "The exam could not be published in its current state.",
    close_failed: "Only a published exam can be closed.",
    archive_failed: "Finish or administer active attempts before archiving this exam.",
    delete_active: "An exam cannot be deleted while its testing window is active.",
    delete_history: "This exam has student history and must be archived instead of deleted.",
    delete_confirmation: "The exam title did not match, so nothing was deleted.",
    delete_failed: "The exam could not be deleted safely.",
  };

  return <div>
    <div className="flex flex-wrap items-start justify-between gap-5">
      <div><p className="eyebrow">Exam administration · {exam.status}</p><h1 className="mt-2 text-3xl font-bold">{exam.title}</h1><p className="mt-2 text-black/55">{exam.description || "No student description yet."}</p></div>
      <div className="flex flex-wrap gap-2"><Link className="btn-secondary" href={`/teacher/exams/${examId}/monitor`}><Radio size={17} />Monitor</Link><Link className="btn-secondary" href={`/teacher/exams/${examId}/results`}><BarChart3 size={17} />Results</Link></div>
    </div>

    {feedback.notice && <p role="status" className="mt-6 rounded-xl border border-green-200 bg-green-50 p-4 text-sm font-semibold text-green-800">Exam updated successfully.</p>}
    {feedback.error && <p role="alert" className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{messages[feedback.error] ?? "That action is not available for the exam’s current state."}</p>}
    {attempts > 0 && <div className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm font-medium">Question content is locked because {attempts} historical attempt{attempts === 1 ? " exists" : "s exist"}. Descriptive metadata remains editable; opening time and shorter closing windows are prohibited.</div>}
    {exam.status === "archived" && <div className="mt-6 rounded-xl border border-black/10 bg-white p-4 text-sm font-medium">This archived exam is read-only. Restore it deliberately before making changes.</div>}

    <ExamManagementActions exam={exam} attempts={attempts} activeAttempts={activeAttempts} validation={validation} contentEditable={contentEditable} canDelete={canDelete} deleteBlockedReason={deleteBlockedReason} />

    <div className="mt-6 grid gap-6">
      <div className="space-y-6">
        <details className="card p-5" open>
          <summary className="cursor-pointer text-lg font-bold">Exam details and instructions</summary>
          <form action={updateExamMetadata} className="stack-form mt-6">
            <input type="hidden" name="examId" value={examId} /><input type="hidden" name="expectedUpdatedAt" value={exam.updated_at} /><input type="hidden" name="operationKey" value={crypto.randomUUID()} />
            <label><span className="label">Title</span><input className="field" name="title" defaultValue={exam.title} minLength={3} maxLength={120} required disabled={!metadataEditable} /></label>
            <label><span className="label">Description</span><textarea className="field min-h-24" name="description" defaultValue={exam.description ?? ""} maxLength={2000} disabled={!metadataEditable} /></label>
            <label><span className="label">Student instructions</span><textarea className="field min-h-32" name="instructions" defaultValue={exam.instructions ?? ""} maxLength={10000} disabled={!metadataEditable} /></label>
            <ExamScheduleFields startAt={exam.scheduled_start_at} endAt={exam.scheduled_end_at} lockStart={attempts > 0 || !metadataEditable} lockEnd={attempts > 0 || !metadataEditable} />
            <label><span className="label">Change note <span className="font-normal text-black/40">(optional)</span></span><input className="field" name="reason" maxLength={1000} placeholder="Why these details changed" disabled={!metadataEditable} /></label>
            <button className="btn-primary w-full sm:w-auto" disabled={!metadataEditable}>Save details</button>
          </form>
        </details>

        {sections.length > 0 && <BuilderAccordionGroup initialSectionId={sections[0].id}>{sections.map((section) => <BuilderSectionAccordion key={section.id} id={section.id} title={section.title} type={section.section_type} order={section.section_order} durationMinutes={section.duration_seconds / 60} questionCount={section.questions.length}>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-black/50">{section.section_type === "module" ? "Manage questions, answer keys, images, and ordering." : "Timed break with no questions attached."}</p>{contentEditable && <MoveButtons examId={examId} kind="section" id={section.id} />}</div>
          {section.section_type === "break" ? <p className="rounded-xl bg-black/[.025] p-4 text-sm text-black/50">Students will see a dedicated break timer and continue when it expires.</p> : <div>
            <div className="space-y-3">{section.questions.map((question) => {
              const key = Array.isArray(question.question_keys) ? question.question_keys[0] : question.question_keys;
              return <article className="rounded-xl border border-black/10 p-4" key={question.id}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start"><div className="min-w-0 flex-1"><p className="text-xs font-bold text-brand">QUESTION {question.question_order} · KEY {key?.correct_option ?? "MISSING"}</p><p className="mt-1 font-medium">{question.optional_text || "Image-based question"}</p></div>{contentEditable && <div className="flex shrink-0 items-center gap-2 self-end sm:self-auto"><MoveButtons examId={examId} kind="question" id={question.id} /><form action={deleteQuestion}><input type="hidden" name="examId" value={examId} /><input type="hidden" name="questionId" value={question.id} /><button className="btn-danger" aria-label={`Delete question ${question.question_order}`}><Trash2 size={15} />Delete</button></form></div>}</div>
                {question.image_url && <div className="mt-4 grid max-h-[32rem] place-items-center overflow-hidden rounded-xl bg-black/[.035] p-2"><Image unoptimized width={1200} height={900} className="h-auto max-h-[30rem] w-auto max-w-full object-contain" src={question.image_url} alt={`Question ${question.question_order}`} /></div>}
                <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2">{(["A", "B", "C", "D"] as const).map((letter) => { const option = question[`option_${letter.toLowerCase()}`]; return <span className="rounded-lg bg-black/[.035] px-3 py-2" key={letter}><b>{letter}</b>{option !== letter && <> {String(option)}</>}</span>; })}</div>
                {contentEditable && <form action={replaceQuestionImage} className="mt-4 rounded-xl border border-dashed border-black/15 p-4"><input type="hidden" name="examId" value={examId} /><input type="hidden" name="questionId" value={question.id} /><input type="hidden" name="expectedOldPath" value={question.image_path ?? ""} /><input type="hidden" name="operationKey" value={crypto.randomUUID()} /><label><span className="label">Replace question image</span><input className="field" name="image" type="file" accept="image/png,image/jpeg,image/webp" required /></label><input className="field mt-3" name="reason" placeholder="Reason for replacement" maxLength={1000} /><ConfirmSubmitButton className="btn-secondary mt-4" label="Replace image" confirmation={`Replace the image for question ${question.question_order}? The old object will be deleted only after the database update succeeds.`} /></form>}
              </article>;
            })}</div>
            {contentEditable && <><BulkQuestionImport examId={examId} sectionId={section.id} userId={viewer.id} /><details className="mt-5 rounded-xl border border-dashed border-black/20 p-4"><summary className="cursor-pointer rounded-lg py-1 font-semibold text-brand">Add one question manually</summary><ManualQuestionForm examId={examId} sectionId={section.id} /></details></>}
          </div>}
        </BuilderSectionAccordion>)}</BuilderAccordionGroup>}
        {!sections.length && <div className="card p-10 text-center text-black/45">Add your first section to begin building the exam.</div>}
      </div>

      <aside className="space-y-5">
        <section className="card p-5"><h2 className="font-bold">Recent administrative activity</h2>{auditEvents.length ? <ol className="mt-4 space-y-4">{auditEvents.map((event) => { const actor = Array.isArray(event.profiles) ? event.profiles[0] : event.profiles; return <li className="border-l-2 border-brand/25 pl-3 text-sm" key={event.id}><p className="font-semibold">{event.action.replaceAll(".", " ")}</p><p className="text-black/45">{actor?.full_name ?? "Teacher"} · {formatAppDateTime(event.created_at)}</p>{event.reason && <p className="mt-1 text-black/55">{event.reason}</p>}</li>; })}</ol> : <p className="mt-3 text-sm text-black/45">No administrative changes recorded yet.</p>}</section>
      </aside>
    </div>
  </div>;
}
