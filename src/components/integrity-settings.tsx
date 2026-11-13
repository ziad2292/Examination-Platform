"use client";
import { useActionState } from "react";
import { ShieldCheck } from "lucide-react";
import { configureIntegrity } from "@/app/actions/integrity";
import { initialFormState } from "@/lib/form-state";
import type { IntegrityPolicy } from "@/lib/integrity";

export function IntegritySettings({
  examId,
  settings,
}: {
  examId: string;
  settings: IntegrityPolicy | null;
}) {
  const [state, action, pending] = useActionState(
    configureIntegrity,
    initialFormState,
  );
  return (
    <section
      className="card mt-6 overflow-hidden"
      aria-labelledby="integrity-settings-heading"
    >
      <div className="flex items-start gap-3 border-b border-black/10 p-5 sm:p-6">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand/5 text-brand">
          <ShieldCheck size={20} aria-hidden="true" />
        </span>
        <div>
          <h2 id="integrity-settings-heading" className="font-bold">
            Exam integrity monitoring
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-black/55">
            Manage monitoring for this assessment. Browser activity is a review
            indicator; it never changes grades or submits an attempt.
          </p>
        </div>
      </div>
      <form action={action} className="space-y-5 p-5 sm:p-6">
        <input type="hidden" name="examId" value={examId} />
        <fieldset className="space-y-3" disabled={pending}>
          <legend className="sr-only">Monitoring options</legend>
          {[
            {
              name: "enabled",
              label: "Enable monitoring",
              description:
                "Record attention, restricted clipboard actions, session overlaps, and connectivity.",
              checked: settings?.enabled ?? false,
            },
            {
              name: "clipboard",
              label: "Restrict clipboard actions",
              description:
                "Block supported copy, cut, paste, print, and save actions in the assessment surface.",
              checked: settings?.restrict_clipboard ?? true,
            },
            {
              name: "enforcement",
              label: "Show incident warnings",
              description:
                "Count incidents using the system policy. Turn off for logging-only monitoring.",
              checked: settings?.enforcement ?? false,
            },
          ].map((option) => (
            <label
              key={option.name}
              className="flex cursor-pointer items-start gap-3 rounded-xl border border-black/10 p-4"
            >
              <input
                className="mt-1 accent-brand"
                name={option.name}
                type="checkbox"
                defaultChecked={option.checked}
              />
              <span>
                <b className="block text-sm">{option.label}</b>
                <span className="mt-1 block text-sm leading-6 text-black/55">
                  {option.description}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-black/10 pt-5">
          <p className="max-w-xl text-xs leading-5 text-black/50">
            Warning rules use values maintained in the Super Admin’s
            Integrity Policy tab. Changes here apply to future attempts.
          </p>
          <button className="btn-primary" disabled={pending}>
            {pending ? "Saving…" : "Save monitoring policy"}
          </button>
        </div>
        {state.message && (
          <p role={state.ok ? "status" : "alert"} className="text-sm">
            {state.message}
          </p>
        )}
      </form>
    </section>
  );
}
