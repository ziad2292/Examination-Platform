"use client";
import { IntegrityModuleLifecycle } from "@/components/exam-integrity-provider";
import { useCallback,useEffect,useRef,useState } from "react";
import { useRouter } from "next/navigation";
import { submitSection } from "@/app/actions/attempts";
import { formatDuration,remainingSeconds } from "@/lib/exam-state";
import { Coffee,LoaderCircle } from "lucide-react";
export function BreakTimer({attemptId,sectionAttemptId,expiresAt,title}:{attemptId:string;sectionAttemptId:string;expiresAt:string;title:string}){
 const router=useRouter();const [seconds,setSeconds]=useState(()=>remainingSeconds(expiresAt));const [pending,setPending]=useState(false);const [error,setError]=useState("");const busy=useRef(false);
 const finish=useCallback(async()=>{if(busy.current)return;busy.current=true;setPending(true);setError("");try{const result=await submitSection(sectionAttemptId);if(result.ok){router.replace(`/student/attempts/${attemptId}`);return;}setError("Your break could not be completed. Check your connection and retry.");}catch{setError("Connection interrupted. Your timer is preserved; retry to continue.");}busy.current=false;setPending(false);},[attemptId,router,sectionAttemptId]);
 useEffect(()=>{const timer=setInterval(()=>{const left=remainingSeconds(expiresAt);setSeconds(left);if(!left){clearInterval(timer);void finish();}},500);return()=>clearInterval(timer);},[expiresAt,finish]);
 return <div className="mx-auto grid max-w-xl place-items-center py-16 text-center"><IntegrityModuleLifecycle sectionAttemptId={null}/><span className="grid size-16 place-items-center rounded-2xl bg-red-50 text-brand"><Coffee size={30}/></span><p className="eyebrow mt-7">Timed break</p><h1 className="mt-2 text-3xl font-bold">{title}</h1><div role="timer" aria-label={`${seconds} seconds remaining`} className="mt-8 font-mono text-6xl font-bold tabular-nums">{formatDuration(seconds)}</div><p className="mt-5 max-w-md text-black/55">Take a moment. Your break continues if you refresh or close this tab.</p>{error&&<p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}<button className="btn-primary mt-8" disabled={pending} onClick={()=>void finish()}>{pending&&<LoaderCircle size={17} className="animate-spin"/>}{pending?"Continuing…":seconds===0?"Continue assessment":"End break early"}</button></div>;
}
