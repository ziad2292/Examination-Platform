import Link from "next/link";
import { ArrowRight,BarChart3,CalendarClock,Plus } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { ExamSummary } from "@/lib/types";

const badge:Record<string,string>={draft:"bg-slate-100 text-slate-700",published:"bg-green-100 text-green-800",closed:"bg-amber-100 text-amber-800",archived:"bg-zinc-100 text-zinc-600"};

export default async function TeacherDashboard(){
  await requireRole("teacher");
  const supabase=await createClient(),{data}=await supabase.from("exams").select("*").order("created_at",{ascending:false}),exams=(data??[]) as ExamSummary[];
  return <><div className="flex flex-wrap items-end justify-between gap-5"><div><p className="eyebrow">Teacher workspace</p><h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Exams</h1><p className="mt-2 text-black/55">Build, schedule, publish, and review your mock exams.</p></div><Link className="btn-primary" href="/teacher/exams/new"><Plus size={18}/>New exam</Link></div>{exams.length===0?<div className="card mt-10 grid place-items-center px-6 py-20 text-center"><CalendarClock className="text-brand" size={36}/><h2 className="mt-4 text-xl font-bold">Create your first mock exam</h2><p className="mt-2 max-w-md text-black/55">Start with the schedule, then add timed modules, a break, and questions.</p><Link className="btn-primary mt-7" href="/teacher/exams/new">Create exam</Link></div>:<div className="mt-8 grid gap-4">{exams.map(exam=><article className="card flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between" key={exam.id}><div className="min-w-0"><div className="flex flex-wrap items-center gap-3"><h2 className="text-lg font-bold">{exam.title}</h2><span className={`rounded-full px-2.5 py-1 text-xs font-bold capitalize ${badge[exam.status]}`}>{exam.status}</span></div><p className="mt-2 flex items-start gap-2 text-sm leading-6 text-black/50"><CalendarClock className="mt-0.5 shrink-0" size={15}/><span>{new Date(exam.scheduled_start_at).toLocaleString()} — {new Date(exam.scheduled_end_at).toLocaleString()}</span></p></div><div className="grid shrink-0 grid-cols-2 gap-2 sm:flex"><Link className="btn-secondary !min-h-10 !px-4" href={`/teacher/exams/${exam.id}/results`}><BarChart3 size={16}/>Results</Link><Link className="btn-secondary !min-h-10 !px-4" href={`/teacher/exams/${exam.id}`}>Manage<ArrowRight size={16}/></Link></div></article>)}</div>}</>;
}
