"use client";
import Link from "next/link";
import { AlertCircle,RefreshCw } from "lucide-react";

export default function ErrorPage({reset}:{error:Error&{digest?:string};reset:()=>void}){
  return <main className="shell grid min-h-[70vh] place-items-center py-16"><section className="card w-full max-w-lg p-8 text-center sm:p-10"><span className="mx-auto grid size-14 place-items-center rounded-2xl bg-red-50 text-red-700"><AlertCircle size={27}/></span><p className="eyebrow mt-6">Something went wrong</p><h1 className="mt-2 text-3xl font-bold">We couldn’t load this page</h1><p className="mt-4 leading-7 text-black/55">Your work is safe. Try again, or return to your dashboard.</p><div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row"><button className="btn-primary" onClick={reset}><RefreshCw size={17}/>Try again</button><Link className="btn-secondary" href="/dashboard">Go to dashboard</Link></div></section></main>;
}
