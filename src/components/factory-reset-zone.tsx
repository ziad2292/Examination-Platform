"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { factoryCleanup } from "@/app/actions/feature-management";
import { PasswordInput } from "@/components/password-input";
import { PendingSubmitButton } from "@/components/pending-submit-button";

type Counts = { exams: number; students: number; attempts: number; answers: number };
const phrases = { exams: "DELETE ALL EXAMS", students: "DELETE ALL STUDENTS", all: "DELETE ALL EXAMS AND STUDENTS" } as const;

export function FactoryResetZone({ counts, configured }: { counts: Counts; configured: boolean }) {
  const [scope, setScope] = useState<keyof typeof phrases>("exams");
  const [confirmation, setConfirmation] = useState("");
  const phrase = phrases[scope];
  return <section className="mt-10 rounded-2xl border-2 border-red-200 bg-red-50/60 p-5 sm:p-6" id="danger-zone">
    <div className="flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-red-100 text-red-700"><AlertTriangle size={20} /></span><div><p className="text-xs font-bold uppercase tracking-[.16em] text-red-700">Danger zone</p><h2 className="mt-1 text-xl font-bold">Factory reset / bulk cleanup</h2><p className="mt-2 text-sm leading-6 text-red-900/70">This removes production records permanently. Export or back up the database before continuing. Teacher and administrator accounts are always preserved.</p></div></div>
    <div className="mt-5 grid gap-3 sm:grid-cols-4">{Object.entries(counts).map(([key,value]) => <div className="rounded-xl border border-red-200 bg-white p-3" key={key}><b className="text-xl">{value}</b><span className="ml-2 text-sm capitalize text-black/50">{key}</span></div>)}</div>
    <form action={factoryCleanup} className="mt-6 grid gap-4"><input type="hidden" name="operationKey" value={crypto.randomUUID()} /><label><span className="label">Cleanup scope</span><select className="field" name="scope" value={scope} onChange={(event) => { setScope(event.target.value as keyof typeof phrases); setConfirmation(""); }}><option value="exams">All exams and dependent exam data ({counts.exams})</option><option value="students">All student accounts and student-owned records ({counts.students})</option><option value="all">All exams and all students</option></select></label><label><span className="label">Type <b>{phrase}</b></span><input className="field" name="confirmation" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" required /></label><PasswordInput label="Confirm your current password" name="password" autoComplete="current-password" required /><div className="flex justify-end"><PendingSubmitButton className="btn-danger min-h-11 px-5" pendingLabel="Running protected cleanup…" disabled={!configured || confirmation !== phrase}><AlertTriangle size={17} />Run protected cleanup</PendingSubmitButton></div></form>
  </section>;
}
