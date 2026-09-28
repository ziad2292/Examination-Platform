"use client";

import { useFormStatus } from "react-dom";

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
}: {
  label: string;
  pendingLabel?: string;
  confirmation: string;
  requiredText?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      className={className}
      type="submit"
      disabled={pending}
      onClick={(event) => {
        const confirmed = window.confirm(confirmation);
        const entered = confirmed && requiredText
          ? window.prompt(`Type “${requiredText}” to confirm.`)
          : null;
        if (!confirmationAccepted(confirmed, requiredText, entered)) event.preventDefault();
      }}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}
