"use client";

import { useState } from "react";
import { Check, Copy, KeyRound } from "lucide-react";

export function ExamCodeCard({ code }: { code: string | null }) {
  const [copied, setCopied] = useState(false);
  const [error,setError]=useState(false);
  if (!code) return <section className="card p-5"><div className="flex items-center gap-2 font-bold"><KeyRound size={18} />Exam code</div><p className="mt-3 text-sm text-black/50">This exam does not require an access code.</p></section>;
  return <section className="card p-5">
    <div className="flex items-center gap-2 font-bold"><KeyRound size={18} />Exam code</div>
    <div className="mt-4 flex flex-wrap items-center gap-3"><code className="rounded-xl bg-black/[.045] px-4 py-3 text-lg font-bold tracking-widest">{code}</code><button className="btn-secondary" type="button" onClick={async () => { try { await navigator.clipboard.writeText(code); setError(false);setCopied(true); window.setTimeout(() => setCopied(false), 2000); } catch { setError(true); } }}>{copied ? <Check size={17} /> : <Copy size={17} />}{copied ? "Copied" : "Copy code"}</button></div>
    <p className="mt-3 text-xs text-black/45" role="status" aria-live="polite">{error ? "Clipboard unavailable. Select and copy the code above." : copied ? "The exam code was copied to the clipboard." : "Only you and authorized administrators can retrieve this code."}</p>
  </section>;
}
