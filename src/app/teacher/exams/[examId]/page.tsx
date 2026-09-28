import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { BarChart3,BookOpen,CheckCircle2,ChevronDown,ChevronUp,Coffee,Plus,Trash2 } from "lucide-react";
import { addQuestion,addSection,changeExamStatus,deleteQuestion,moveBuilderItem,publishExam } from "@/app/actions/exams";
import { BulkQuestionImport } from "@/components/bulk-question-import";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type Question={id:string;question_order:number;optional_text:string|null;image_path:string|null;image_url?:string;option_a:string;option_b:string;option_c:string;option_d:string;[key:string]:string|number|null|undefined};
type Section={id:string;title:string;section_type:"module"|"break";section_order:number;duration_seconds:number;questions:Question[]};

function MoveButtons({examId,kind,id}:{examId:string;kind:"section"|"question";id:string}){
  return <div className="flex shrink-0 gap-1">{([-1,1] as const).map(direction=><form action={moveBuilderItem} key={direction}>
    <input type="hidden" name="examId" value={examId}/><input type="hidden" name="kind" value={kind}/><input type="hidden" name="id" value={id}/><input type="hidden" name="direction" value={direction}/>
    <button className="icon-button" title={`Move ${direction<0?"up":"down"}`} aria-label={`Move ${kind} ${direction<0?"up":"down"}`}>{direction<0?<ChevronUp size={17}/>:<ChevronDown size={17}/>}</button>
  </form>)}</div>;
}

export default async function ExamEditor({params}:{params:Promise<{examId:string}>}){
  const viewer=await requireRole("teacher"),{examId}=await params,supabase=await createClient();
  const {data:exam}=await supabase.from("exams").select("*").eq("id",examId).single(); if(!exam)notFound();
  const {data}=await supabase.from("exam_sections").select("id,title,section_type,section_order,duration_seconds,questions(id,question_order,optional_text,image_path,option_a,option_b,option_c,option_d)").eq("exam_id",examId).order("section_order").order("question_order",{referencedTable:"questions"});
  const sections=(data??[]) as Section[];
  const imagePaths=sections.flatMap(section=>section.questions.flatMap(question=>question.image_path?[question.image_path]:[]));
  const signedImages=imagePaths.length?await supabase.storage.from("question-images").createSignedUrls(imagePaths,3600):{data:[]};
  const imageUrls=new Map((signedImages.data??[]).map(image=>[image.path,image.signedUrl]));
  sections.forEach(section=>section.questions.forEach(question=>{if(question.image_path)question.image_url=imageUrls.get(question.image_path)??undefined;}));
  const {count:attempts}=await supabase.from("exam_attempts").select("id",{count:"exact",head:true}).eq("exam_id",examId);
  const locked=Boolean(attempts),editable=!locked&&["draft","published"].includes(exam.status);

  return <div>
    <div className="flex flex-wrap items-start justify-between gap-5"><div><p className="eyebrow">Exam builder · {exam.status}</p><h1 className="mt-2 text-3xl font-bold">{exam.title}</h1><p className="mt-2 text-black/55">{exam.description||"No student instructions yet."}</p></div><Link className="btn-secondary" href={`/teacher/exams/${examId}/results`}><BarChart3 size={17}/>View results</Link></div>
    {locked&&<div className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm font-medium">Content is locked because a student has started this exam.</div>}
    {!locked&&!editable&&<div className="mt-6 rounded-xl border border-black/10 bg-white p-4 text-sm font-medium">This exam is {exam.status} and its content is read-only.</div>}
    <div className="mt-8 grid gap-6 xl:grid-cols-[1fr_340px]">
      <div className="space-y-5">{sections.map(section=><section className="card overflow-hidden" key={section.id}>
        <header className="flex flex-wrap items-center gap-4 border-b border-black/10 bg-black/[.02] p-5"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-green-50 text-brand">{section.section_type==="module"?<BookOpen size={19}/>:<Coffee size={19}/>}</span><div className="min-w-40 flex-1"><p className="text-xs font-bold uppercase text-black/40">{section.section_type} {section.section_order}</p><h2 className="font-bold">{section.title}</h2></div><span className="text-sm font-semibold text-black/50">{section.duration_seconds/60} min</span>{editable&&<MoveButtons examId={examId} kind="section" id={section.id}/>}</header>
        {section.section_type==="break"?<p className="p-5 text-sm text-black/50">Timed break. No questions attached.</p>:<div className="p-5">
          <div className="space-y-3">{section.questions.map(question=><article className="rounded-xl border border-black/10 p-4" key={question.id}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start"><div className="min-w-0 flex-1"><p className="text-xs font-bold text-brand">QUESTION {question.question_order}</p><p className="mt-1 font-medium">{question.optional_text||"Image-based question"}</p></div>{editable&&<div className="flex shrink-0 items-center gap-2 self-end sm:self-auto"><MoveButtons examId={examId} kind="question" id={question.id}/><form action={deleteQuestion}><input type="hidden" name="examId" value={examId}/><input type="hidden" name="questionId" value={question.id}/><button className="btn-danger" aria-label={`Delete question ${question.question_order}`}><Trash2 size={15}/>Delete</button></form></div>}</div>
            {question.image_url&&<div className="mt-4 grid max-h-[32rem] place-items-center overflow-hidden rounded-xl bg-black/[.035] p-2"><Image unoptimized width={1200} height={900} className="max-h-[30rem] h-auto w-auto max-w-full object-contain" src={question.image_url} alt={`Question ${question.question_order}`}/></div>}
            <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2">{(["A","B","C","D"] as const).map(letter=>{const option=question[`option_${letter.toLowerCase()}`];return <span className="rounded-lg bg-black/[.035] px-3 py-2" key={letter}><b>{letter}</b>{option!==letter&&<> {option}</>}</span>;})}</div>
          </article>)}</div>
          {editable&&<><BulkQuestionImport examId={examId} sectionId={section.id} userId={viewer.id}/><details className="mt-5 rounded-xl border border-dashed border-black/20 p-4"><summary className="cursor-pointer rounded-lg py-1 font-semibold text-brand">Add one question manually</summary><form action={addQuestion} className="stack-form mt-6"><input type="hidden" name="examId" value={examId}/><input type="hidden" name="sectionId" value={section.id}/><label className="block"><span className="label">Question text</span><textarea className="field min-h-24" name="text"/></label><label className="block"><span className="label">Question image <span className="font-normal text-black/40">(optional)</span></span><input className="field" name="image" type="file" accept="image/png,image/jpeg,image/webp"/></label><div className="grid gap-4 sm:grid-cols-2">{["A","B","C","D"].map(letter=><label className="block" key={letter}><span className="label">Option {letter}</span><input className="field" name={`option${letter}`} required/></label>)}</div><label className="block"><span className="label">Correct option</span><select className="field" name="correctOption">{["A","B","C","D"].map(letter=><option key={letter}>{letter}</option>)}</select></label><button className="btn-primary w-full sm:w-auto"><Plus size={17}/>Add question</button></form></details></>}
        </div>}
      </section>)}{!sections.length&&<div className="card p-10 text-center text-black/45">Add your first section to begin building the exam.</div>}</div>
      <aside className="space-y-5"><section className="card p-5"><h2 className="font-bold">Exam status</h2><p className="mt-2 text-sm leading-6 text-black/50">Publishing validates modules. Content locks after the first attempt.</p>{exam.status==="draft"&&editable&&<form action={publishExam} className="mt-5"><input type="hidden" name="examId" value={examId}/><button className="btn-primary w-full"><CheckCircle2 size={17}/>Publish</button></form>}{exam.status==="published"&&<form action={changeExamStatus} className="mt-5"><input type="hidden" name="examId" value={examId}/><input type="hidden" name="status" value="closed"/><button className="btn-secondary w-full">Close exam</button></form>}</section>
      {editable&&<section className="card p-5"><h2 className="font-bold">Add section</h2><form action={addSection} className="stack-form mt-5"><input type="hidden" name="examId" value={examId}/><label className="block"><span className="label">Title</span><input className="field" name="title" required/></label><label className="block"><span className="label">Type</span><select className="field" name="sectionType"><option value="module">Module</option><option value="break">Break</option></select></label><label className="block"><span className="label">Duration (minutes)</span><input className="field" name="durationMinutes" type="number" min="1" max="240" required defaultValue="32"/></label><button className="btn-primary w-full"><Plus size={17}/>Add section</button></form></section>}</aside>
    </div>
  </div>;
}
