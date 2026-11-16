"use client";
import { useState } from "react";
export function QuestionNavigator({ items }: { items: { id:string; label:string; content:React.ReactNode }[] }) {
  const [selected,setSelected]=useState(0);
  const index=Math.min(selected,Math.max(0,items.length-1));
  if(!items.length)return <p className="rounded-xl border border-dashed border-black/15 p-8 text-center text-sm text-black/45">No questions yet. Add a question or import a set below.</p>;
  return <div><div className="mb-4 flex flex-wrap items-center gap-2" aria-label="Question navigation">{items.map((item,i)=><button type="button" key={item.id} className={`icon-button ${index===i?"!bg-brand !text-white":""}`} aria-label={item.label} aria-pressed={index===i} onClick={()=>setSelected(i)}>{i+1}</button>)}</div>{items.map((item,i)=><div key={item.id} hidden={index!==i}>{item.content}</div>)}<div className="mt-4 flex items-center justify-between"><button className="btn-secondary" type="button" disabled={index===0} onClick={()=>setSelected(index-1)}>Previous question</button><span className="text-xs text-black/45">{index+1} of {items.length}</span><button className="btn-secondary" type="button" disabled={index===items.length-1} onClick={()=>setSelected(index+1)}>Next question</button></div></div>;
}
