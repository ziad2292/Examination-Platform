"use client";

import { useMemo, useState } from "react";
import { Search, Users } from "lucide-react";
import { saveExamAssignments } from "@/app/actions/feature-management";
import { PendingSubmitButton } from "@/components/pending-submit-button";

type Student = { id: string; full_name: string; email: string };

export function ExamAssignmentManager({ examId, students, assignedIds, lockedIds }: { examId: string; students: Student[]; assignedIds: string[]; lockedIds: string[] }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(() => new Set(assignedIds));
  const filtered = useMemo(() => students.filter((student) => `${student.full_name} ${student.email}`.toLowerCase().includes(query.toLowerCase())), [query, students]);
  const locked = useMemo(() => new Set(lockedIds), [lockedIds]);
  const allFilteredSelected = filtered.length > 0 && filtered.every((student) => selected.has(student.id));
  const toggleAll = () => setSelected((current) => { const next = new Set(current); filtered.forEach((student) => { if (allFilteredSelected && !locked.has(student.id)) next.delete(student.id); else next.add(student.id); }); return next; });
  return <section className="card p-5" id="assignments">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="flex items-start gap-3"><span className="grid size-10 place-items-center rounded-xl bg-green-50 text-brand"><Users size={19} /></span><div><h2 className="font-bold">Student assignments</h2><p className="text-sm text-black/50">Only your assigned students can be added to this exam.</p></div></div><span className="rounded-full bg-black/[.04] px-3 py-1 text-xs font-bold">{selected.size} selected</span></div>
    <label className="relative mt-5 block"><span className="sr-only">Search students</span><Search className="absolute left-3 top-3.5 text-black/35" size={17} /><input className="field pl-10" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name or email" /></label>
    <form action={saveExamAssignments} className="mt-4"><input type="hidden" name="examId" value={examId} />
      {[...selected].map((id) => <input key={id} type="hidden" name="studentId" value={id} />)}
      <div className="overflow-hidden rounded-xl border border-black/10"><div className="flex items-center gap-3 bg-black/[.025] px-4 py-3"><input type="checkbox" checked={allFilteredSelected} onChange={toggleAll} aria-label="Select all filtered students" /><span className="text-sm font-semibold">Select all {filtered.length} matching students</span></div><div className="max-h-72 overflow-y-auto">{filtered.map((student) => <label className="flex cursor-pointer items-center gap-3 border-t border-black/10 px-4 py-3 hover:bg-black/[.02]" key={student.id}><input type="checkbox" checked={selected.has(student.id)} disabled={locked.has(student.id)} onChange={() => setSelected((current) => { const next = new Set(current); if(next.has(student.id)) next.delete(student.id); else next.add(student.id); return next; })} /><span className="min-w-0"><b className="block truncate text-sm">{student.full_name}</b><span className="block truncate text-xs text-black/45">{student.email}{locked.has(student.id) ? " · locked by existing attempt" : ""}</span></span></label>)}{!filtered.length && <p className="p-8 text-center text-sm text-black/45">No eligible students match this search.</p>}</div></div>
      <div className="mt-4 flex justify-end"><PendingSubmitButton pendingLabel="Saving assignments…">Save assignments</PendingSubmitButton></div>
    </form>
  </section>;
}
