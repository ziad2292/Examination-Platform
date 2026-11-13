import Link from "next/link";
import { IntegrityBeginButton } from "@/components/integrity-begin-button";
import { IntegrityModuleLifecycle } from "@/components/exam-integrity-provider";
import { notFound,redirect } from "next/navigation";
import { BookOpen,Coffee,Clock3 } from "lucide-react";
import { startSection } from "@/app/actions/attempts";
import { createClient } from "@/lib/supabase/server";

type Section={id:string;title:string;section_type:"module"|"break";section_order:number;duration_seconds:number;questions:{id:string}[];section_attempts:{id:string;status:string}[]};

export default async function AttemptProgress({params,searchParams}:{params:Promise<{attemptId:string}>;searchParams:Promise<{error?:string}>}){
  const {attemptId}=await params,{error}=await searchParams,supabase=await createClient();
  const {data:attemptData}=await supabase.rpc("student_attempt_summary",{target_attempt:attemptId}).maybeSingle();
  const attempt=attemptData as null|{id:string;status:string;raw_score:number|null;total_questions:number|null;exam_id:string;exam_title:string;results_visible:boolean};
  if(!attempt)notFound();
  if(attempt.status!=="in_progress")return <div className="mx-auto max-w-2xl py-16 text-center"><span className="mx-auto grid size-14 place-items-center rounded-full bg-green-100 text-2xl">✓</span><p className="eyebrow mt-6">Attempt closed</p><h1 className="mt-2 text-4xl font-bold">{attempt.status==="completed"?"Exam complete":"Attempt preserved"}</h1><p className="mt-4 text-lg text-black/55">Your answers are locked and available to your teacher. If a retake is authorized, start it from the exam overview.</p><Link className="btn-primary mt-8" href="/student">Back to Home</Link></div>;
  const exam={id:attempt.exam_id,title:attempt.exam_title};
  const {data}=await supabase.from("exam_sections").select("id,title,section_type,section_order,duration_seconds,questions(id),section_attempts!left(id,status)").eq("exam_id",exam.id).eq("section_attempts.exam_attempt_id",attemptId).order("section_order");
  const sections=(data??[]) as Section[],active=sections.flatMap(section=>section.section_attempts.filter(item=>item.status==="in_progress"));
  if(active[0])redirect(`/student/attempts/${attemptId}/sections/${active[0].id}`);
  const next=sections.find(section=>!section.section_attempts.some(item=>["submitted","expired"].includes(item.status)));
  if(!next)redirect("/student");
  return <div className="mx-auto max-w-2xl py-8"><IntegrityModuleLifecycle sectionAttemptId={null}/><div className="card overflow-hidden"><div className="grid place-items-center bg-green-50 py-12 text-brand">{next.section_type==="module"?<BookOpen size={48}/>:<Coffee size={48}/>}</div><div className="p-7 sm:p-10"><p className="eyebrow">Up next · {exam.title}</p><h1 className="mt-2 text-3xl font-bold">{next.title}</h1><div className="mt-5 flex flex-wrap gap-5 text-sm font-semibold text-black/55"><span className="flex items-center gap-2"><Clock3 size={17}/>{next.duration_seconds/60} minutes</span>{next.section_type==="module"&&<span>{next.questions.length} questions</span>}</div><p className="mt-6 leading-7 text-black/55">{next.section_type==="module"?"The timer begins when you click below. You can navigate freely inside this module, but you cannot return after submitting it.":"Your break timer begins when you click below. Refreshing will not restart it."}</p>{error&&<p role="alert" className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">We couldn’t begin this section. Please try again.</p>}<form action={startSection} className="mt-8"><input type="hidden" name="attemptId" value={attemptId}/><input type="hidden" name="sectionId" value={next.id}/><IntegrityBeginButton module={next.section_type==="module"}/></form></div></div></div>;
}
