"use client";
import { useActionState, useState } from "react";
import { saveAdminIntegrityPolicy } from "@/app/actions/admin-integrity";
import { initialFormState } from "@/lib/form-state";
import { ShieldCheck, SlidersHorizontal, ListChecks } from "lucide-react";

export type IntegrityConstants = {
  threshold: number;
  cooldown_seconds: number;
  attention_seconds: number;
  heartbeat_seconds: number;
  stale_seconds: number;
  delayed_seconds: number;
  queue_limit: number;
  retention_days: number;
};

export function AdminIntegrityPolicy({
  policy,
}: {
  policy: IntegrityConstants;
}) {
  const [selected, setSelected] = useState(0);
  const [result, action, pending] = useActionState(saveAdminIntegrityPolicy, initialFormState);
  const tabs = ["Policy settings", "Monitoring & review"];
  const fields = ["threshold", "cooldown_seconds", "attention_seconds", "heartbeat_seconds", "stale_seconds", "delayed_seconds", "queue_limit", "retention_days"] as const;
  const values = [
    [
      "Review threshold",
      `${policy.threshold} counted incidents`,
      "Flags an attempt for teacher review; never changes grades or submits it.",
    ],
    [
      "Incident cooldown",
      `${policy.cooldown_seconds} seconds`,
      "Applied on the server per incident category to suppress duplicate warnings.",
    ],
    [
      "Attention qualification",
      `${policy.attention_seconds} seconds`,
      "Short focus or visibility changes do not count.",
    ],
    [
      "Heartbeat interval",
      `${policy.heartbeat_seconds} seconds`,
      "Independent of answer saving and section timers.",
    ],
    [
      "Stale connection",
      `${policy.stale_seconds} seconds`,
      "Shown as connection unknown, never counted as cheating.",
    ],
    [
      "Delayed observations",
      `${policy.delayed_seconds} seconds`,
      "Older observations are retained without increasing incident counts.",
    ],
    [
      "Telemetry queue limit",
      `${policy.queue_limit} events`,
      "Bounded storage contains monitoring events, never exam answers.",
    ],
    [
      "Raw history retention",
      `${policy.retention_days} days`,
      "After attempt completion. Review decisions and aggregates remain.",
    ],
  ];
  return (
    <div>
      <header className="flex items-start gap-4">
        <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-brand/5 text-brand">
          <ShieldCheck aria-hidden="true" />
        </span>
        <div>
          <p className="eyebrow">System policy</p>
          <h1 className="mt-2 text-3xl font-bold">Integrity policy</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-black/55">
            Set the platform-wide integrity policy. Teachers choose monitoring
            options per assessment.
          </p>
        </div>
      </header>
      <div
        role="tablist"
        aria-label="Integrity policy"
        className="focus-tabs"
        onKeyDown={(event) => {
          const target =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? 1
                : event.key === "ArrowRight" || event.key === "ArrowLeft"
                  ? 1 - selected
                  : null;
          if (target !== null) {
            event.preventDefault();
            setSelected(target);
            document.getElementById(`integrity-policy-tab-${target}`)?.focus();
          }
        }}
      >
        {tabs.map((label, index) => (
          <button
            key={label}
            id={`integrity-policy-tab-${index}`}
            type="button"
            role="tab"
            aria-selected={selected === index}
            aria-controls={`integrity-policy-panel-${index}`}
            tabIndex={selected === index ? 0 : -1}
            className={selected === index ? "selected" : ""}
            onClick={() => setSelected(index)}
          >
            {index === 0 ? (
              <SlidersHorizontal size={16} aria-hidden="true" />
            ) : (
              <ListChecks size={16} aria-hidden="true" />
            )}
            {label}
          </button>
        ))}
      </div>
      <section
        role="tabpanel"
        id="integrity-policy-panel-0"
        aria-labelledby="integrity-policy-tab-0"
        hidden={selected !== 0}
      >
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold">System values</h2>
        </div>
        <form action={action}>
        <div className="grid gap-4 md:grid-cols-2">
          {values.map(([label, value, description], index) => (
            <label key={label} className="card p-5 sm:p-6">
              <span className="label">{label}</span>
              <input className="field mt-2" type="number" name={fields[index]} defaultValue={policy[fields[index]]} required min={1} step={1} />
              <span className="mt-2 block text-sm leading-6 text-black/55">
                Current value: {value}. {description}
              </span>
            </label>
          ))}
        </div>
        <button className="btn-primary mt-5" disabled={pending}>{pending ? "Saving…" : "Save integrity policy"}</button>
        {result.message && <p className="mt-3" role={result.ok ? "status" : "alert"}>{result.message}</p>}
        </form>
        <p className="mt-5 text-xs leading-6 text-black/50">
          Monitoring changes apply to new attempts. The retention period applies
          to completed attempts when the scheduled cleanup runs.
        </p>
      </section>
      <section
        role="tabpanel"
        id="integrity-policy-panel-1"
        aria-labelledby="integrity-policy-tab-1"
        hidden={selected !== 1}
        className="card p-5 sm:p-6"
      >
        <h2 className="text-lg font-bold">What is monitored</h2>
        <ul className="mt-4 list-disc space-y-3 pl-5 text-sm leading-6 text-black/60">
          <li>Focus and tab visibility during active question modules.</li>
          <li>
            Supported clipboard and print/save restrictions when the teacher
            enables them.
          </li>
          <li>
            Overlapping browser sessions. Multiple sessions remain allowed.
          </li>
          <li>Connectivity, reloads, and exits are informational only.</li>
        </ul>
        <div className="mt-6 border-t border-black/10 pt-6">
          <h3 className="font-bold">Review and privacy</h3>
          <p className="mt-3 text-sm leading-7 text-black/60">
            Browser activity is a review indicator, not proof of cheating.
            Teachers may dismiss observations or add private notes. There are no
            automatic penalties, webcam recordings, screenshots, clipboard
            contents, or fullscreen checks.
          </p>
        </div>
      </section>
    </div>
  );
}
