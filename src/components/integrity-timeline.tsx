"use client";
import { useActionState, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { reviewIntegrity } from "@/app/actions/integrity";
import { initialFormState } from "@/lib/form-state";
type Event = {
  event_id: string;
  type: string;
  category: string;
  observed_at: string;
  received_at: string;
  counted: boolean;
  decision: string;
};
type Review = {
  id: string;
  event_id: string | null;
  action: string;
  reason: string;
  created_at: string;
};
export function IntegrityTimeline({
  examId,
  attemptId,
}: {
  examId: string;
  attemptId: string;
}) {
  const [page, setPage] = useState(0);
  const [events, setEvents] = useState<Event[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [state, action, pending] = useActionState(
    reviewIntegrity,
    initialFormState,
  );
  useEffect(() => {
    let disposed = false;
    const db = createClient();
    Promise.all([
      db
        .from("attempt_integrity_events")
        .select(
          "event_id,type,category,observed_at,received_at,counted,decision",
        )
        .eq("attempt_id", attemptId)
        .order("received_at", { ascending: false })
        .range(page * 20, page * 20 + 19),
      db
        .from("integrity_review_actions")
        .select("id,event_id,action,reason,created_at")
        .eq("attempt_id", attemptId)
        .order("created_at", { ascending: false })
        .limit(100),
    ]).then(([e, r]) => {
      if (disposed) return;
      setLoading(false);
      if (e.error || r.error)
        setError("The monitoring timeline could not be loaded.");
      else {
        setEvents((e.data ?? []) as Event[]);
        setReviews((r.data ?? []) as Review[]);
        setError("");
      }
    });
    return () => {
      disposed = true;
    };
  }, [attemptId, page, state]);
  return (
    <section className="card mt-6 p-5">
      <h2 className="font-bold">Integrity timeline & review</h2>
      <p className="mt-1 text-xs text-black/50">
        Raw observations are immutable. Dismissals adjust review counts, never
        grades. Delayed and suppressed events are not counted.
      </p>
      {loading && (
        <p role="status" className="mt-4">
          Loading timeline…
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="mt-4 space-y-3">
        {events.map((e) => {
          const latest = reviews.find(
            (r) =>
              r.event_id === e.event_id &&
              ["dismiss", "reinstate"].includes(r.action),
          );
          return (
            <article
              key={e.event_id}
              className="rounded-xl border border-black/10 p-3 text-sm"
            >
              <b>{e.type.replaceAll("_", " ")}</b>
              <p>
                {e.decision} ·{" "}
                {latest?.action === "dismiss"
                  ? "dismissed"
                  : e.counted
                    ? "counted"
                    : "not counted"}
              </p>
              <p className="text-xs text-black/45">
                Observed {new Date(e.observed_at).toLocaleString()} · Received{" "}
                {new Date(e.received_at).toLocaleString()}
              </p>
              <form action={action} className="mt-3 flex flex-wrap gap-2">
                <input type="hidden" name="examId" value={examId} />
                <input type="hidden" name="attemptId" value={attemptId} />
                <input type="hidden" name="eventId" value={e.event_id} />
                <input
                  type="hidden"
                  name="action"
                  value={latest?.action === "dismiss" ? "reinstate" : "dismiss"}
                />
                <input
                  className="field flex-1"
                  name="reason"
                  aria-label="Review reason"
                  placeholder="Reason for review decision"
                  minLength={3}
                  maxLength={1000}
                  required
                />
                <button className="btn-secondary" disabled={pending}>
                  {latest?.action === "dismiss" ? "Reinstate" : "Dismiss"}
                </button>
              </form>
            </article>
          );
        })}
        {!loading && !events.length && (
          <p className="text-sm text-black/45">No observations on this page.</p>
        )}
      </div>
      <div className="my-4 flex justify-between">
        <button
          className="btn-secondary"
          disabled={!page}
          onClick={() => setPage(page - 1)}
        >
          Previous
        </button>
        <button
          className="btn-secondary"
          disabled={events.length < 20}
          onClick={() => setPage(page + 1)}
        >
          Next
        </button>
      </div>
      <form action={action} className="flex flex-wrap gap-3">
        <input type="hidden" name="examId" value={examId} />
        <input type="hidden" name="attemptId" value={attemptId} />
        <input type="hidden" name="action" value="note" />
        <textarea
          className="field flex-1"
          name="reason"
          aria-label="Private teacher note"
          placeholder="Add a private teacher note"
          required
          minLength={3}
          maxLength={1000}
        />
        <button className="btn-secondary" disabled={pending}>
          Add note
        </button>
      </form>
      {state.message && (
        <p role={state.ok ? "status" : "alert"} className="mt-3 text-sm">
          {state.message}
        </p>
      )}
      <details className="mt-4">
        <summary className="cursor-pointer font-semibold">
          Review history & private notes
        </summary>
        {reviews.map((r) => (
          <p key={r.id} className="mt-3 text-sm">
            <b>{r.action}</b> · {r.reason}
            <span className="block text-xs text-black/45">
              {new Date(r.created_at).toLocaleString()}
            </span>
          </p>
        ))}
      </details>
    </section>
  );
}
