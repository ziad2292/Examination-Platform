"use client";

import { createContext, type ReactNode, useContext, useState } from "react";
import { BookOpen, CheckCircle2, Coffee } from "lucide-react";

const BuilderAccordionContext = createContext<{ activeId: string | null; setActiveId: (id: string | null) => void } | null>(null);

export function nextActiveSection(currentId: string | null, selectedId: string) {
  return currentId === selectedId ? null : selectedId;
}

export function BuilderAccordionGroup({ initialSectionId, children }: { initialSectionId: string; children: ReactNode }) {
  const [activeId, setActive] = useState<string | null>(initialSectionId);
  return <BuilderAccordionContext.Provider value={{ activeId, setActiveId: (id) => setActive((current) => id === null ? null : nextActiveSection(current, id)) }}><div><div className="mb-3 flex justify-end"><button className="btn-ghost !min-h-9 text-sm" type="button" disabled={activeId === null} onClick={() => setActive(null)}>Minimize all sections</button></div><div className="space-y-4">{children}</div></div></BuilderAccordionContext.Provider>;
}

export function BuilderSectionAccordion({
  title,
  id,
  type,
  order,
  durationMinutes,
  questionCount,
  children,
}: {
  id: string;
  title: string;
  type: "module" | "break";
  order: number;
  durationMinutes: number;
  questionCount: number;
  children: ReactNode;
}) {
  const accordion = useContext(BuilderAccordionContext);
  if (!accordion) throw new Error("BuilderSectionAccordion must be inside BuilderAccordionGroup");
  const expanded = accordion.activeId === id;
  return <section className="card overflow-hidden" data-builder-section={type}>
    <button type="button" className="flex w-full cursor-pointer items-center gap-4 p-5 text-left hover:bg-black/[.02]" aria-expanded={expanded} onClick={() => accordion.setActiveId(id)}>
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-green-50 text-brand">{type === "module" ? <BookOpen size={19} /> : <Coffee size={19} />}</span>
      <div className="min-w-0 flex-1"><p className="text-xs font-bold uppercase tracking-wide text-black/40">{type} {order}</p><h2 className="truncate font-bold">{title}</h2></div>
      {type === "module" && <span className="hidden items-center gap-1 text-xs font-semibold text-brand sm:flex"><CheckCircle2 size={15} />{questionCount} question{questionCount === 1 ? "" : "s"}</span>}
      <span className="whitespace-nowrap text-sm font-semibold text-black/50">{durationMinutes} min</span>
      <span className={`text-lg text-black/35 transition ${expanded ? "rotate-180" : ""}`} aria-hidden>⌄</span>
    </button>
    {expanded && <div className="border-t border-black/10 p-5">{children}</div>}
  </section>;
}
