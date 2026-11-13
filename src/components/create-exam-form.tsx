"use client";

import { startTransition, useActionState, useState } from "react";
import { createExam } from "@/app/actions/exams";
import { LoaderCircle } from "lucide-react";
import { ExamScheduleFields } from "@/components/exam-schedule-fields";
import { initialFormState } from "@/lib/form-state";

export function CreateExamForm({ requestId }: { requestId: string }) {
  const [state, action, pending] = useActionState(createExam, initialFormState);
  const [step,setStep]=useState(0);
  return <form action={action} onSubmit={event => {
    event.preventDefault();
    if (pending) return;
    const formData = new FormData(event.currentTarget);
    startTransition(() => action(formData));
  }} className="stack-form card mt-8 p-6 sm:p-8" onInvalidCapture={(event)=>{const panel=(event.target as HTMLElement).closest("[data-step]");if(panel)setStep(Number(panel.getAttribute("data-step")));}}><input type="hidden" name="requestId" value={requestId} /><nav className="focus-tabs" aria-label="Create assessment">{["Information","Access & results","Schedule & create"].map((label,i)=><button type="button" key={label} aria-pressed={step===i} className={step===i?"selected":""} onClick={()=>setStep(i)}>{i+1}. {label}</button>)}</nav><div data-step="0" className="space-y-5" hidden={step!==0}>
    <label className="block"><span className="label">Exam title</span><input className="field" name="title" required minLength={3} placeholder="e.g. End-of-term assessment" /></label>
    <label className="block"><span className="label">Description</span><textarea className="field min-h-28" name="description" maxLength={2000} placeholder="A short overview for students" /></label>
    <label className="block"><span className="label">Student instructions</span><textarea className="field min-h-32" name="instructions" maxLength={10000} placeholder="Rules, materials, and what students should expect" /></label>
    </div><div data-step="1" className="space-y-5" hidden={step!==1}><label className="block"><span className="label">Access code <span className="font-normal text-black/40">(optional)</span></span><input className="field uppercase" name="accessCode" maxLength={24} /></label>
    <label className="flex items-start gap-3 rounded-xl border border-black/10 p-4"><input className="mt-1 accent-brand" type="checkbox" name="showResults" /><span><b className="block">Show results to students</b><span className="text-sm text-black/50">Students can see their score after completion. Answer keys and teacher notes stay private.</span></span></label>
    </div><div data-step="2" hidden={step!==2}><ExamScheduleFields /><p className="mt-4 text-sm text-black/50">Create your draft, then add modules, assign students, and review it before publishing.</p></div>
    {state.message && <p className={`rounded-xl p-3 text-sm font-semibold ${state.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`} role={state.ok ? "status" : "alert"}>{state.message}</p>}
    {step<2&&<button className="btn-secondary w-full" type="button" onClick={()=>setStep(step+1)}>Continue →</button>}
    <button hidden={step!==2} className="btn-primary w-full" type="submit" disabled={pending} aria-busy={pending}>{pending && <LoaderCircle size={17} className="animate-spin" aria-hidden="true" />}{pending ? "Creating exam…" : "Create and add sections"}</button>
  </form>;
}
