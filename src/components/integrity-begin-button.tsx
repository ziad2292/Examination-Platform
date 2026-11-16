"use client";
import { useFormStatus } from "react-dom";
export function IntegrityBeginButton({ module }: { module: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button className="btn-primary w-full" type="submit" disabled={pending}>
      {pending ? "Starting…" : `Begin ${module ? "module" : "break"}`}
    </button>
  );
}
