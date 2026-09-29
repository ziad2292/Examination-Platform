"use client";

import { useActionState, useState } from "react";
import { CalendarClock, CheckCircle2, Copy, Plus, Trash2, X } from "lucide-react";
import { archiveExam, closeExam, deleteExam, duplicateExam, publishExamAdmin, rescheduleExam, restoreExam } from "@/app/actions/exam-administration";
import { addSection } from "@/app/actions/exams";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { ExamScheduleFields } from "@/components/exam-schedule-fields";
import { initialFormState } from "@/lib/form-state";
import type { ExamStatus } from "@/lib/types";

type Validation = { ready: boolean; errors: string[]; modules: number; breaks: number; questions: number; answerKeys: number; scheduleValid: boolean };

function Modal({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  if (!open) return null;
  return <div className="fixed inset-0 z-40 grid place-items-center overflow-y-auto bg-black/45 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="my-8 w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl" role="dialog" aria-modal="true" aria-label={title}>
      <div className="flex items-center justify-between gap-4"><h2 className="text-xl font-bold">{title}</h2><button className="icon-button" type="button" aria-label={`Close ${title}`} onClick={onClose}><X size={18} /></button></div>
      <div className="mt-5">{children}</div>
    </section>
  </div>;
}

export function ExamManagementActions({
  exam,
  attempts,
  activeAttempts,
  validation,
  contentEditable,
  canDelete,
  deleteBlockedReason,
}: {
  exam: { id: string; title: string; status: ExamStatus; scheduled_start_at: string; scheduled_end_at: string; updated_at: string };
  attempts: number;
  activeAttempts: number;
  validation: Validation | null;
  contentEditable: boolean;
  canDelete: boolean;
  deleteBlockedReason: string | null;
}) {
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [sectionOpen, setSectionOpen] = useState(false);
  const [scheduleState, scheduleAction, schedulePending] = useActionState(rescheduleExam, initialFormState);
  const [sectionState, sectionAction, sectionPending] = useActionState(addSection, initialFormState);
  return <section className="card mt-8 p-5">
    <div className="flex flex-wrap items-center gap-2">
      {exam.status !== "archived" && <button className="btn-secondary" type="button" onClick={() => setScheduleOpen(true)}><CalendarClock size={17} />Reschedule{exam.status === "closed" ? " / reopen" : ""}</button>}
      {contentEditable && <button className="btn-secondary" type="button" onClick={() => setSectionOpen(true)}><Plus size={17} />Add section</button>}
      {exam.status === "draft" && <form action={publishExamAdmin}><input type="hidden" name="examId" value={exam.id} /><ConfirmSubmitButton className="btn-primary" label="Publish exam" confirmation={`Publish “${exam.title}” for students during its scheduled window?`} disabled={!validation?.ready} /></form>}
      {exam.status === "closed" && <form action={publishExamAdmin}><input type="hidden" name="examId" value={exam.id} /><ConfirmSubmitButton className="btn-primary" label="Reopen exam" confirmation={`Reopen “${exam.title}” using its current schedule? Students with a valid window and authorization will be able to start.`} disabled={!validation?.ready} /></form>}
      {exam.status === "published" && <form action={closeExam}><input type="hidden" name="examId" value={exam.id} /><input type="hidden" name="reason" value="Closed from exam administration" /><ConfirmSubmitButton className="btn-secondary" label="Close exam" confirmation={`Close “${exam.title}”? No new attempts can begin, while active attempt data remains preserved.`} /></form>}
      <form action={duplicateExam}><input type="hidden" name="examId" value={exam.id} /><input type="hidden" name="newTitle" value={`${exam.title} (Copy)`} /><button className="btn-secondary" type="submit"><Copy size={17} />Duplicate</button></form>
      {exam.status === "archived" ? <form action={restoreExam}><input type="hidden" name="examId" value={exam.id} /><input type="hidden" name="reason" value="Restored from exam administration" /><ConfirmSubmitButton className="btn-secondary" label="Restore exam" confirmation={`Restore “${exam.title}”? It will return as ${attempts ? "closed" : "a draft"}.`} /></form> : activeAttempts === 0 && <form action={archiveExam}><input type="hidden" name="examId" value={exam.id} /><input type="hidden" name="reason" value="Archived from exam administration" /><ConfirmSubmitButton className="btn-secondary" label="Archive exam" confirmation={`Archive “${exam.title}”? Results stay available, but the exam becomes read-only.`} /></form>}
      {canDelete && <form action={deleteExam}><input type="hidden" name="examId" value={exam.id} /><input type="hidden" name="confirmationTitle" value={`DELETE ${exam.title}`} /><input type="hidden" name="reason" value="Permanently deleted exam and related historical results" /><ConfirmSubmitButton className="btn-danger" label="Permanently delete exam" requiredText={`DELETE ${exam.title}`} confirmation={`This permanently deletes “${exam.title}”, including every section, question, answer key, student attempt, answer, score, regrade record, and associated image. This cannot be undone.`} /></form>}
    </div>
    <div className="mt-4 flex flex-wrap items-start justify-between gap-3 border-t border-black/10 pt-4 text-sm">
      <p className="text-black/55"><b>{validation?.questions ?? 0}</b> questions · <b>{validation?.modules ?? 0}</b> modules · <b>{validation?.answerKeys ?? 0}</b> answer keys</p>
      {validation?.ready ? <span className="inline-flex items-center gap-1 font-semibold text-brand"><CheckCircle2 size={16} />Ready to publish</span> : <span className="max-w-xl text-red-700">{validation?.errors?.join(" · ") || "Complete the exam structure and schedule before publishing."}</span>}
    </div>
    {deleteBlockedReason && <p className="mt-3 inline-flex items-start gap-2 text-xs leading-5 text-amber-700"><Trash2 className="mt-0.5 shrink-0" size={14} />{deleteBlockedReason}</p>}
    {activeAttempts > 0 && <p className="mt-2 text-xs text-amber-700">Archive is unavailable while {activeAttempts} attempt{activeAttempts === 1 ? " is" : "s are"} active.</p>}

    <Modal open={scheduleOpen} title={exam.status === "closed" ? "Reschedule or reopen exam" : "Reschedule exam"} onClose={() => setScheduleOpen(false)}>
      <p className="text-sm leading-6 text-black/55">{attempts ? "The opening time is preserved exactly. You may extend the closing time without changing active section timers." : "Adjust the window when students may begin the exam."}</p>
      <form action={scheduleAction} className="stack-form mt-5"><input type="hidden" name="examId" value={exam.id} /><input type="hidden" name="expectedUpdatedAt" value={exam.updated_at} /><input type="hidden" name="reopen" value={exam.status === "closed" ? "true" : "false"} /><ExamScheduleFields startAt={exam.scheduled_start_at} endAt={exam.scheduled_end_at} lockStart={attempts > 0} /><label><span className="label">Reason <span className="font-normal text-black/40">(optional)</span></span><input className="field" name="reason" maxLength={1000} placeholder="Add a note for the audit history" /></label>{scheduleState.message && <p className={`rounded-xl p-3 text-sm ${scheduleState.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`} role={scheduleState.ok ? "status" : "alert"}>{scheduleState.message}</p>}<button className="btn-primary" disabled={schedulePending}>{schedulePending ? "Saving schedule…" : exam.status === "closed" ? "Save and reopen" : "Save schedule"}</button></form>
    </Modal>
    <Modal open={sectionOpen} title="Add section" onClose={() => setSectionOpen(false)}>
      <form action={sectionAction} className="stack-form"><input type="hidden" name="examId" value={exam.id} /><label className="block"><span className="label">Section name</span><input className="field" name="title" required minLength={1} maxLength={120} placeholder="Module 1 or 2" /></label><label className="block"><span className="label">Type</span><select className="field" name="sectionType"><option value="module">Timed module</option><option value="break">Break</option></select></label><label className="block"><span className="label">Duration (minutes)</span><input className="field" name="durationMinutes" type="number" min="1" max="240" required defaultValue="32" /></label>{sectionState.message && <p className={`rounded-xl p-3 text-sm ${sectionState.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`} role={sectionState.ok ? "status" : "alert"}>{sectionState.message}</p>}<button className="btn-primary" disabled={sectionPending}>{sectionPending ? "Adding section…" : "Add section"}</button></form>
    </Modal>
  </section>;
}
