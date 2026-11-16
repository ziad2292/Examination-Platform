"use client";

import { useEffect, useRef, useState } from "react";

export function BuilderWorkspace({ panels }: { panels: { id: string; label: string; content: React.ReactNode }[] }) {
  const [selected, setSelected] = useState("overview");
  const [dirty, setDirty] = useState(false);
  const region = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const read = () => { const value = new URLSearchParams(location.search).get("panel"); if (value && panels.some(p => p.id === value)) setSelected(value); };
    read(); window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, [panels]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    const navigate = (event: MouseEvent) => { const link=(event.target as HTMLElement).closest("a[href]");if(dirty && link && !link.getAttribute("href")?.startsWith("#") && !window.confirm("Leave this assessment? Unsaved changes will be lost.")){event.preventDefault();event.stopPropagation();} };
    window.addEventListener("beforeunload", warn);document.addEventListener("click",navigate,true);
    return () => {window.removeEventListener("beforeunload", warn);document.removeEventListener("click",navigate,true);};
  }, [dirty]);
  return <div ref={region} className="builder-workspace" onChangeCapture={() => setDirty(true)} onSubmitCapture={() => setDirty(false)}><nav className="focus-tabs" aria-label="Assessment builder">{panels.map((panel,index) => <button key={panel.id} type="button" aria-pressed={selected === panel.id} className={selected === panel.id ? "selected" : ""} onClick={() => { setSelected(panel.id); const url = new URL(location.href); url.searchParams.set("panel", panel.id); history.pushState(null,"",url); }}><span>{String(index+1).padStart(2,"0")}</span>{panel.label}</button>)}</nav><p className="mb-4 text-xs text-black/45" role="status">{dirty ? "Unsaved changes · save the relevant form before leaving this page." : "Changes are saved with each section’s Save action."}</p>{panels.map(panel => <div key={panel.id} hidden={selected !== panel.id} aria-label={panel.label}>{panel.content}</div>)}</div>;
}
