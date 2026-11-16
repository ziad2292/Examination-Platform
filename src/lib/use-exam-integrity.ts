"use client";
import { createAttentionTracker } from "@/lib/integrity-attention";
import {
  useEffect,
  useRef,
  useState,
  useCallback,
  type RefObject,
} from "react";
import {
  acknowledgeObservations,
  appendObservation,
  isCalculatorOrEditable,
  queuedObservationSchema,
  integrityBatch,
  identityKey,
  type QueuedObservation,
  type IntegrityIdentity,
  type IntegrityObservation,
  type IntegritySummary,
} from "@/lib/integrity";
export function useIntegrityTransport(
  attemptId: string,
  initial: IntegritySummary | null = null,
) {
  const [summary, setSummary] = useState<IntegritySummary | null>(initial);
  const [ready, setReady] = useState(
    Boolean(initial) || process.env.NEXT_PUBLIC_INTEGRITY_ENABLED !== "true",
  );
  const [transportError, setTransportError] = useState(false);
  const queue = useRef<QueuedObservation[]>([]);
  const identity = useRef<IntegrityIdentity | null>(null);
  const moduleId = useRef<string | null>(null);
  const suspended = useRef(false);
  const busy = useRef(false);
  const registered = useRef(new Set<string>());
  const seq = useRef(0);
  const failures = useRef(0);
  const nextRetry = useRef(0);
  const policy = useRef(summary);
  const storageKey = `assessly-integrity-${attemptId}`;
  const persist = useCallback(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(queue.current));
    } catch {
      /* Storage unavailable must never affect answers. */
    }
  }, [storageKey]);
  const flush = useCallback(async () => {
    if (!identity.current || busy.current || Date.now() < nextRetry.current)
      return;
    busy.current = true;
    try {
      // Replay each original document's queue before registering this document.
      // Never attribute a previous page's exit to the refreshed page.
      for (let pass = 0; pass < 6; pass++) {
        const batch = integrityBatch(queue.current, identity.current);
        const key = identityKey(batch);
        const response = await fetch(
          `/api/integrity/${!registered.current.has(key) ? "session" : "sync"}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              attemptId,
              ...batch,
            }),
          },
        );
        if (!response.ok) throw new Error("Monitoring sync failed");
        const data = (await response.json()) as IntegritySummary;
        registered.current.add(key);
        failures.current = 0;
        nextRetry.current = 0;
        setTransportError(false);
        queue.current = acknowledgeObservations(
          queue.current,
          data.acknowledged ?? [],
        );
        if (!data.enabled) queue.current = [];
        persist();
        policy.current = data;
        setSummary(data);
        setReady(true);
        if (
          !data.enabled ||
          (!queue.current.length && key === identityKey(identity.current))
        )
          break;
      }
    } catch {
      setTransportError(true);
      nextRetry.current =
        Date.now() +
        Math.min(60000, 1000 * 2 ** Math.min(++failures.current, 6)) +
        Math.random() * 1000;
    } finally {
      busy.current = false;
    }
  }, [attemptId, persist]);
  const emit = useCallback(
    (type: IntegrityObservation["type"], immediate = false) => {
      if (!identity.current || policy.current?.enabled === false) return;
      const event = {
        eventId: crypto.randomUUID(),
        sequence: ++seq.current,
        type,
        sectionAttemptId: moduleId.current,
        observedAt: new Date().toISOString(),
        metadata: {},
        identity: { ...identity.current },
      };
      const limit = policy.current?.policy?.queue_limit ?? 200;
      const overflow = queue.current.length >= limit;
      queue.current = appendObservation(queue.current, event, limit);
      if (overflow && type !== "overflow")
        queue.current = appendObservation(queue.current, {
          ...event,
          eventId: crypto.randomUUID(),
          sequence: ++seq.current,
          type: "overflow",
        }, limit);
      persist();
      if (immediate) void flush();
    },
    [flush, persist],
  );
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_INTEGRITY_ENABLED !== "true") return;
    let instance: string;
    try {
      instance =
        sessionStorage.getItem(`integrity-instance-${attemptId}`) ||
        crypto.randomUUID();
      sessionStorage.setItem(`integrity-instance-${attemptId}`, instance);
      const parsed = JSON.parse(sessionStorage.getItem(storageKey) || "[]");
      queue.current = Array.isArray(parsed)
        ? parsed
            .filter((e) => queuedObservationSchema.safeParse(e).success)
            .slice(-(policy.current?.policy?.queue_limit ?? 200))
        : [];
    } catch {
      instance = crypto.randomUUID();
    }
    identity.current = {
      browserInstanceId: instance,
      documentId: crypto.randomUUID(),
    };
    seq.current = Math.max(0, ...queue.current.map((e) => e.sequence));
    const channel =
      typeof BroadcastChannel !== "undefined"
        ? new BroadcastChannel(`assessly-instance-${attemptId}`)
        : null;
    const documentId = identity.current.documentId;
    channel?.addEventListener("message", (event) => {
      if (
        event.data?.type === "probe" &&
        event.data.instance === identity.current?.browserInstanceId &&
        event.data.document !== documentId
      ) {
        channel.postMessage({
          type: "claimed",
          instance: identity.current?.browserInstanceId,
          to: event.data.document,
        });
      }
      if (
        event.data?.type === "claimed" &&
        event.data.to === documentId &&
        identity.current
      ) {
        identity.current.browserInstanceId = crypto.randomUUID();
        try {
          sessionStorage.setItem(
            `integrity-instance-${attemptId}`,
            identity.current.browserInstanceId,
          );
        } catch {}
        registered.current.clear();
      }
    });
    channel?.postMessage({ type: "probe", instance, document: documentId });
    const startup = setTimeout(() => {
      emit("reload");
      void flush();
    }, 150);
    const batch = setInterval(() => {
      if (queue.current.length) void flush();
    }, 5000);
    const heartbeat = setInterval(() => void flush(), (policy.current?.policy?.heartbeat_seconds ?? 20) * 1000);
    const online = () => {
      nextRetry.current = 0;
      emit("reconnect", true);
    };
    const offline = () => emit("offline");
    const exit = () => {
      emit("exit");
      if (identity.current) {
        const payload = JSON.stringify({
          attemptId,
          ...identity.current,
          observations: integrityBatch(
            queue.current.filter(
              (e) =>
                identityKey(e.identity) === identityKey(identity.current!) &&
                ["exit", "offline", "reload", "reconnect"].includes(e.type),
            ),
            identity.current,
          ).observations,
        });
        navigator.sendBeacon?.(
          "/api/integrity/exit",
          new Blob([payload], { type: "application/json" }),
        );
      }
    };
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    window.addEventListener("pagehide", exit);
    return () => {
      channel?.close();
      clearTimeout(startup);
      clearInterval(batch);
      clearInterval(heartbeat);
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
      window.removeEventListener("pagehide", exit);
    };
  }, [attemptId, emit, flush, storageKey]);
  const setModule = useCallback(
    (id: string | null) => {
      moduleId.current = id;
      suspended.current = false;
      if (id) emit("module_ready", true);
    },
    [emit],
  );
  const suspend = useCallback(() => {
    suspended.current = true;
    moduleId.current = null;
  }, []);
  return {
    summary,
    ready,
    transportError,
    emit,
    policy,
    moduleId,
    suspended,
    setModule,
    suspend,
  };
}
export function useIntegrityDetectors(
  root: RefObject<HTMLDivElement | null>,
  moduleId: RefObject<string | null>,
  suspended: RefObject<boolean>,
  policy: RefObject<IntegritySummary | null>,
  emit: (type: IntegrityObservation["type"], immediate?: boolean) => void,
  path: string,
) {
  useEffect(() => {
    const active = () =>
      Boolean(
        moduleId.current && !suspended.current && policy.current?.enabled,
      );
    const attention = createAttentionTracker(active, (type) => emit(type, true),
      () => (policy.current?.policy?.attention_seconds ?? 2) * 1000);
    const lost = attention.lost;
    const returned = () => {
      if (document.hidden || !document.hasFocus()) return;
      attention.returned();
    };
    const visibility = () => (document.hidden ? lost() : returned());
    const restriction = (event: Event) => {
      if (
        active() &&
        policy.current?.policy?.restrict_clipboard &&
        !isCalculatorOrEditable(
          (event.target as Element)?.closest?.("[data-calculator]"),
        )
      ) {
        if (event.cancelable) event.preventDefault();
        emit("clipboard", true);
      }
    };
    const shortcut = (event: KeyboardEvent) => {
      if (
        active() &&
        policy.current?.policy?.restrict_clipboard &&
        !isCalculatorOrEditable(event.target) &&
        (event.ctrlKey || event.metaKey) &&
        ["p", "s"].includes(event.key.toLowerCase())
      ) {
        if (event.cancelable) event.preventDefault();
        emit("shortcut", true);
      }
    };
    window.addEventListener("blur", lost);
    window.addEventListener("focus", returned);
    document.addEventListener("visibilitychange", visibility);
    const surface = root.current;
    for (const type of ["copy", "cut", "paste"])
      surface?.addEventListener(type, restriction);
    surface?.addEventListener("keydown", shortcut);
    return () => {
      attention.dispose();
      window.removeEventListener("blur", lost);
      window.removeEventListener("focus", returned);
      document.removeEventListener("visibilitychange", visibility);
      for (const type of ["copy", "cut", "paste"])
        surface?.removeEventListener(type, restriction);
      surface?.removeEventListener("keydown", shortcut);
    };
  }, [emit, path, root, moduleId, suspended, policy]);
}
