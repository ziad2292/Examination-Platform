import { describe, it, expect } from "vitest";
import {
  acknowledgeObservations,
  appendObservation,
  syncSchema,
  integrityBatch,
  type IntegrityIdentity,
  type IntegrityObservation,
} from "./integrity";
const event = (i: number): IntegrityObservation => ({
  eventId: `ab000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
  sequence: i,
  type: "offline",
  sectionAttemptId: null,
  observedAt: "2026-11-06T12:00:00.000Z",
  metadata: {},
});
describe("integrity transport contracts", () => {
  it("replays queued observations under their original document identity", () => {
    const old: IntegrityIdentity = {
      browserInstanceId: event(8).eventId,
      documentId: event(9).eventId,
    };
    const current = { ...old, documentId: event(10).eventId };
    const exit = { ...event(1), type: "exit" as const, identity: old };
    const reload = { ...event(2), type: "reload" as const, identity: current };
    const batch = integrityBatch([exit, reload], current);
    expect(batch.documentId).toBe(old.documentId);
    expect(batch.observations).toEqual([{ ...event(1), type: "exit" }]);
    expect(
      syncSchema.safeParse({ attemptId: event(3).eventId, ...batch }).success,
    ).toBe(true);
    const remaining = acknowledgeObservations([exit, reload], [exit.eventId]);
    expect(integrityBatch(remaining, current).documentId).toBe(
      current.documentId,
    );
    expect(integrityBatch([], current).documentId).toBe(current.documentId);
  });
  it("retains only a bounded telemetry queue and ignores duplicate UUIDs", () => {
    let queue: IntegrityObservation[] = [];
    for (let i = 1; i <= 250; i++) queue = appendObservation(queue, event(i));
    expect(queue).toHaveLength(200);
    expect(queue[0].sequence).toBe(51);
    expect(appendObservation(queue, event(250))).toHaveLength(200);
    expect(appendObservation(queue, event(251), 30)).toEqual(
      Array.from({ length: 30 }, (_, index) => event(222 + index)),
    );
  });
  it("removes only explicitly acknowledged events", () =>
    expect(
      acknowledgeObservations([event(1), event(2)], [event(1).eventId]),
    ).toEqual([event(2)]));
  it("rejects forged counters and clipboard metadata", () => {
    const payload = {
      attemptId: event(1).eventId,
      browserInstanceId: event(2).eventId,
      documentId: event(3).eventId,
      observations: [event(4)],
    };
    expect(syncSchema.safeParse(payload).success).toBe(true);
    expect(
      syncSchema.safeParse({
        ...payload,
        observations: [{ ...event(4), type: "fullscreen_exit" }],
      }).success,
    ).toBe(false);
    expect(syncSchema.safeParse({ ...payload, count: 3 }).success).toBe(false);
    expect(
      syncSchema.safeParse({
        ...payload,
        observations: [{ ...event(4), metadata: { clipboard: "private" } }],
      }).success,
    ).toBe(false);
  });
  it("rejects oversized batches and unknown events", () => {
    const payload = {
      attemptId: event(1).eventId,
      browserInstanceId: event(2).eventId,
      documentId: event(3).eventId,
      observations: Array.from({ length: 51 }, (_, i) => event(i + 1)),
    };
    expect(syncSchema.safeParse(payload).success).toBe(false);
    expect(
      syncSchema.safeParse({
        ...payload,
        observations: [{ ...event(1), type: "score_changed" }],
      }).success,
    ).toBe(false);
  });
});
