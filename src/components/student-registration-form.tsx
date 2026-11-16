"use client";

import { useActionState, useState } from "react";
import { registerStudent } from "@/app/actions/registration";
import { PasswordInput } from "@/components/password-input";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { initialFormState } from "@/lib/form-state";

export function StudentRegistrationForm() {
  const [state, action, pending] = useActionState(registerStudent, initialFormState);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  return (
    <form action={action} className="stack-form mt-6">
      <label>
        <span className="label">Full name</span>
        <input className="field" name="name" autoComplete="name" required minLength={2} maxLength={120}
          value={name} onChange={event => setName(event.target.value)} readOnly={pending} />
      </label>
      <label>
        <span className="label">Email address</span>
        <input className="field" name="email" type="email" autoComplete="email" required maxLength={254}
          value={email} onChange={event => setEmail(event.target.value)} readOnly={pending} />
      </label>
      <PasswordInput label="Password" name="password" autoComplete="new-password" required minLength={12}
        maxLength={72} value={password} onChange={event => setPassword(event.target.value)} readOnly={pending} />
      <p className="text-xs text-black/55">Use at least 12 characters.</p>
      {state.message && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800" role="alert">{state.message}</p>}
      <PendingSubmitButton pendingLabel="Submitting request…">Submit registration</PendingSubmitButton>
    </form>
  );
}
