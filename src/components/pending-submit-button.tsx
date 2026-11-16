"use client";

import { LoaderCircle } from "lucide-react";
import { useFormStatus } from "react-dom";

export function PendingSubmitButton({
  children,
  pendingLabel = "Working…",
  className = "btn-primary",
  disabled = false,
  name,
  value,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  className?: string;
  disabled?: boolean;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return <button type="submit" name={name} value={value} className={className} disabled={disabled || pending} aria-busy={pending}>
    {pending && <LoaderCircle className="animate-spin" size={17} aria-hidden="true" />}
    <span className="inline-flex items-center justify-center gap-2" aria-live="polite">{pending ? pendingLabel : children}</span>
  </button>;
}
