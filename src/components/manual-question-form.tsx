"use client";

import { useActionState } from "react";
import { Plus } from "lucide-react";
import { addQuestion } from "@/app/actions/exams";
import { initialFormState } from "@/lib/form-state";

export function ManualQuestionForm({ examId, sectionId }: { examId: string; sectionId: string }) {
  const [state, action, pending] = useActionState(addQuestion, initialFormState);
  return <form action={action} className="stack-form mt-6">
    <input type="hidden" name="examId" value={examId} />
    <input type="hidden" name="sectionId" value={sectionId} />
    <label><span className="label">Question text</span><textarea className="field min-h-24" name="text" /></label>
    <label><span className="label">Question image <span className="font-normal text-black/40">(optional)</span></span><input className="field" name="image" type="file" accept="image/png,image/jpeg,image/webp" /></label>
    <div className="grid gap-4 sm:grid-cols-2">{["A", "B", "C", "D"].map((letter) => <label key={letter}><span className="label">Option {letter}</span><input className="field" name={`option${letter}`} required /></label>)}</div>
    <label><span className="label">Correct option</span><select className="field" name="correctOption">{["A", "B", "C", "D"].map((letter) => <option key={letter}>{letter}</option>)}</select></label>
    {state.message && <p className={`rounded-xl p-3 text-sm ${state.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`} role={state.ok ? "status" : "alert"}>{state.message}</p>}
    <button className="btn-primary w-full sm:w-auto" disabled={pending}><Plus size={17} />{pending ? "Adding question…" : "Add question"}</button>
  </form>;
}
