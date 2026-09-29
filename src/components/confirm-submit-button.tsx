"use client";

import { useEffect, useId, useState } from "react";
import { useFormStatus } from "react-dom";
import { X } from "lucide-react";

export function confirmationAccepted(
  confirmed: boolean,
  requiredText?: string,
  enteredText?: string | null,
) {
  return confirmed && (!requiredText || enteredText === requiredText);
}

export function ConfirmSubmitButton({
  label,
  pendingLabel = "Working…",
  confirmation,
  requiredText,
  className = "btn-secondary",
  disabled = false,
}: {
  label: string;
  pendingLabel?: string;
  confirmation: string;
  requiredText?: string;
  className?: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  const [open, setOpen] = useState(false);
  const [enteredText, setEnteredText] = useState("");
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) setOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open, pending]);
  return (
    <>
      <button className={className} type="button" disabled={pending || disabled} onClick={() => { setEnteredText(""); setOpen(true); }}>
        {pending ? pendingLabel : label}
      </button>
      {open && <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) setOpen(false); }}>
        <section className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby={titleId}>
          <div className="flex items-start justify-between gap-4"><div><p className="eyebrow">Please confirm</p><h2 className="mt-2 text-xl font-bold" id={titleId}>{label}</h2></div><button className="icon-button" type="button" aria-label="Close confirmation" disabled={pending} onClick={() => setOpen(false)}><X size={18} /></button></div>
          <p className="mt-4 text-sm leading-6 text-black/60">{confirmation}</p>
          {requiredText && <label className="mt-5 block"><span className="label">Type <b>{requiredText}</b> to continue</span><input className="field" autoFocus value={enteredText} onChange={(event) => setEnteredText(event.target.value)} /></label>}
          <div className="mt-6 flex justify-end gap-3"><button className="btn-ghost" type="button" disabled={pending} onClick={() => setOpen(false)}>Cancel</button><button className={className} type="submit" disabled={pending || !confirmationAccepted(true, requiredText, enteredText)}>{pending ? pendingLabel : label}</button></div>
        </section>
      </div>}
    </>
  );
}
