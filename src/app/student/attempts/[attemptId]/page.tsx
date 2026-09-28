import { notFound,redirect } from "next/navigation";
import { BookOpen,Coffee,Clock3 } from "lucide-react";
import { startSection } from "@/app/actions/attempts";
import { createClient } from "@/lib/supabase/server";

type Section={id:string;title:string;section_type:"module"|"break";section_order:number;duration_seconds:number;questions:{id:string}[];section_attempts:{id:string;status:string}[]};

export default async function AttemptProgress({params,searchParams}:{params:Promise<{attemptId:string}>;searchParams:Promise<{error?:string}>}){
  const {attemptId}=await params,{error}=await searchParams,supabase=await createClient();
  const {data:attempt}=await supabase.from("exam_attempts").select("id,status,raw_score,total_questions,exams(id,title)").eq("id",attemptId).single();
  if(!attempt)notFound();
  if(attempt.status==="completed")return <div className="mx-auto max-w-2xl py-16 text-center"><span className="mx-auto grid size-14 place-items-center rounded-full bg-green-100 text-2xl">✓</span><p className="eyebrow mt-6">Submission received</p><h1 className="mt-2 text-4xl font-bold">Exam complete</h1><p className="mt-4 text-lg text-black/55">Your answers are locked and available to your teacher. You may now close this page.</p></div>;
  const exam=Array.isArray(attempt.exams)?attempt.exams[0]:attempt.exams;
  const {data}=await supabase.from("exam_sections").select("id,title,section_type,section_order,duration_seconds,questions(id),section_attempts!left(id,status)").eq("exam_id",exam.id).eq("section_attempts.exam_attempt_id",attemptId).order("section_order");
  const sections=(data??[]) as Section[],active=sections.flatMap(section=>section.section_attempts.filter(item=>item.status==="in_progress"));
  if(active[0])redirect(`/student/attempts/${attemptId}/sections/${active[0].id}`);
  const next=sections.find(section=>!section.section_attempts.some(item=>["submitted","expired"].includes(item.status)));
  if(!next)redirect("/student");
  return <div className="mx-auto max-w-2xl py-8"><div className="card overflow-hidden"><div className="grid place-items-center bg-green-50 py-12 text-brand">{next.section_type==="module"?<BookOpen size={48}/>:<Coffee size={48}/>}</div><div className="p-7 sm:p-10"><p className="eyebrow">Up next · {exam.title}</p><h1 className="mt-2 text-3xl font-bold">{next.title}</h1><div className="mt-5 flex flex-wrap gap-5 text-sm font-semibold text-black/55"><span className="flex items-center gap-2"><Clock3 size={17}/>{next.duration_seconds/60} minutes</span>{next.section_type==="module"&&<span>{next.questions.length} questions</span>}</div><p className="mt-6 leading-7 text-black/55">{next.section_type==="module"?"The timer begins when you click below. You can navigate freely inside this module, but you cannot return after submitting it.":"Your break timer begins when you click below. Refreshing will not restart it."}</p>{error&&<p role="alert" className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">We couldn’t begin this section. Please try again.</p>}<form action={startSection} className="mt-8"><input type="hidden" name="attemptId" value={attemptId}/><input type="hidden" name="sectionId" value={next.id}/><button className="btn-primary w-full">Begin {next.section_type}</button></form></div></div></div>;
}
