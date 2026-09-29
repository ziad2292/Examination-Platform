"use client";

import { useActionState } from "react";
import { createExam } from "@/app/actions/exams";
import { ExamScheduleFields } from "@/components/exam-schedule-fields";
import { initialFormState } from "@/lib/form-state";

export function CreateExamForm() {
  const [state, action, pending] = useActionState(createExam, initialFormState);
  return <form action={action} className="stack-form card mt-8 p-6 sm:p-8">
    <label className="block"><span className="label">Exam title</span><input className="field" name="title" required minLength={3} placeholder="SAT Mock 1" /></label>
    <label className="block"><span className="label">Description</span><textarea className="field min-h-28" name="description" maxLength={2000} placeholder="A short overview for students" /></label>
    <label className="block"><span className="label">Student instructions</span><textarea className="field min-h-32" name="instructions" maxLength={10000} placeholder="Rules, materials, and what students should expect" /></label>
    <label className="block"><span className="label">Access code <span className="font-normal text-black/40">(optional)</span></span><input className="field uppercase" name="accessCode" maxLength={24} /></label>
    <ExamScheduleFields />
    {state.message && <p className={`rounded-xl p-3 text-sm font-semibold ${state.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`} role={state.ok ? "status" : "alert"}>{state.message}</p>}
    <button className="btn-primary w-full" type="submit" disabled={pending}>{pending ? "Creating exam…" : "Create and add sections"}</button>
  </form>;
}
