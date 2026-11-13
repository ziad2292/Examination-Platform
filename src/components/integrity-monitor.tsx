"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { ShieldCheck } from "lucide-react";
import Link from "next/link";
type Summary = {
  policy?: { stale_seconds?: number };
  student_name?: string;
  attempt_id: string;
  counted_incidents: number;
  review_required: boolean;
  review_cycle: number;
  last_contact_at: string | null;
  overlap_active: boolean;
};
export function IntegrityMonitor({
  examId,
  rows,
  enabled,
}: {
  examId: string;
  rows: Summary[];
  enabled: boolean;
}) {
  const router = useRouter();
  const [notice, setNotice] = useState("");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(timer);
  }, []);
  const cycles = useRef(
    new Map(rows.map((r) => [r.attempt_id, r.review_cycle])),
  );
  useEffect(() => {
    const db = createClient();
    const channel = db
      .channel(`integrity-monitor-${examId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "attempt_integrity_state",
          filter: `exam_id=eq.${examId}`,
        },
        (payload: { new: unknown }) => {
          const row = payload.new as Summary;
          if (
            row.review_required &&
            row.review_cycle > (cycles.current.get(row.attempt_id) ?? 0)
          ) {
            setNotice(
              "An attempt reached the integrity review threshold. Review the updated monitoring list.",
            );
            cycles.current.set(row.attempt_id, row.review_cycle);
          }
          router.refresh();
        },
      )
      .subscribe((status: string) => {
        if (status === "SUBSCRIBED") router.refresh();
      });
    return () => {
      void db.removeChannel(channel);
    };
  }, [examId, router]);
  useEffect(() => {
    const timer = setTimeout(() => {
      for (const row of rows) {
        if (
          row.review_required &&
          row.review_cycle > (cycles.current.get(row.attempt_id) ?? 0)
        )
          setNotice(
            "An attempt reached the integrity review threshold. Review the updated list.",
          );
        cycles.current.set(row.attempt_id, row.review_cycle);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [rows]);
  return (
    <section
      aria-labelledby="integrity-monitor-heading"
      className="card mt-8 overflow-hidden"
    >
      <div className="border-b border-black/10 px-5 py-5 sm:px-6">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand/5 text-brand">
            <ShieldCheck size={20} aria-hidden="true" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h2 id="integrity-monitor-heading" className="font-bold">
                Integrity monitoring
              </h2>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-semibold ${enabled ? "bg-brand/5 text-brand" : "bg-black/5 text-black/55"}`}
              >
                {enabled ? "On" : "Off"}
              </span>
            </div>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-black/50">
              Observations are review indicators. Stale contact means connection
              unknown, never proof of cheating. Live updates fall back to the
              page’s 15-second refresh.
            </p>
            {!enabled && (
              <p className="mt-2 text-sm leading-6 text-black/55">
                Monitoring is off for new attempts. Existing monitored attempts
                retain their saved policy.
              </p>
            )}
            <Link
              className="mt-3 inline-flex text-sm font-semibold text-brand underline-offset-4 hover:underline"
              href={`/teacher/exams/${examId}?panel=settings`}
            >
              Configure monitoring →
            </Link>
          </div>
        </div>
        {notice && (
          <p role="status" className="mt-3 rounded-xl bg-amber-50 p-3 text-sm">
            {notice}
          </p>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-black/[.025] text-xs uppercase tracking-wider text-black/45">
            <tr>
              {[
                "Attempt",
                "Incidents",
                "Review",
                "Last contact",
                "Sessions",
              ].map((s) => (
                <th className="p-3" key={s}>
                  {s}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.attempt_id} className="border-t border-black/10">
                <td className="p-3">
                  <a
                    className="text-brand"
                    href={`/teacher/attempts/${r.attempt_id}`}
                  >
                    {r.student_name ?? `Attempt ${r.attempt_id.slice(0, 8)}`} →
                  </a>
                </td>
                <td className="p-3">{r.counted_incidents}</td>
                <td className="p-3">
                  {r.review_required ? "Review required" : "No flag"}
                </td>
                <td className="p-3">
                  {r.last_contact_at
                    ? now - Date.parse(r.last_contact_at) > (r.policy?.stale_seconds ?? 60) * 1000
                      ? "Connection unknown"
                      : new Date(r.last_contact_at).toLocaleTimeString()
                    : "No contact"}
                </td>
                <td className="p-3">
                  {r.overlap_active ? "Recent overlap" : "No recorded overlap"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <p className="p-4 text-sm text-black/45">
            {enabled
              ? "No monitoring summaries yet. They appear when students begin monitored attempts."
              : "No monitored attempts to display. Enable monitoring in exam settings to collect observations for future attempts."}
          </p>
        )}
      </div>
    </section>
  );
}
