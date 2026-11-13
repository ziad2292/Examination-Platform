import { z } from "zod";
export const integrityEventTypes = [
  "attention_lost",
  "attention_returned",
  "clipboard",
  "shortcut",
  "offline",
  "reconnect",
  "reload",
  "exit",
  "overflow",
  "module_ready",
] as const;
export const observationSchema = z.strictObject({
  eventId: z.guid(),
  sequence: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  type: z.enum(integrityEventTypes),
  sectionAttemptId: z.guid().nullable(),
  observedAt: z.iso.datetime(),
  metadata: z.strictObject({}).default({}),
});
export const syncSchema = z.strictObject({
  attemptId: z.guid(),
  browserInstanceId: z.guid(),
  documentId: z.guid(),
  observations: z.array(observationSchema).max(50).default([]),
});
export type IntegrityObservation = z.infer<typeof observationSchema>;
export const integrityIdentitySchema = z.strictObject({
  browserInstanceId: z.guid(),
  documentId: z.guid(),
});
export type IntegrityIdentity = z.infer<typeof integrityIdentitySchema>;
export const queuedObservationSchema = observationSchema.extend({
  identity: integrityIdentitySchema,
});
export type QueuedObservation = z.infer<typeof queuedObservationSchema>;
export function identityKey(identity: IntegrityIdentity) {
  return `${identity.browserInstanceId}/${identity.documentId}`;
}
export function integrityBatch(
  queue: QueuedObservation[],
  current: IntegrityIdentity,
) {
  const identity = queue[0]?.identity ?? current;
  const observations = queue
    .filter((e) => identityKey(e.identity) === identityKey(identity))
    .slice(0, 50)
    .map((e) => ({
      eventId: e.eventId,
      sequence: e.sequence,
      type: e.type,
      sectionAttemptId: e.sectionAttemptId,
      observedAt: e.observedAt,
      metadata: e.metadata,
    }));
  return { ...identity, observations };
}
export type IntegrityPolicy = {
  attention_seconds?: number;
  heartbeat_seconds?: number;
  stale_seconds?: number;
  queue_limit?: number;
  enabled: boolean;
  restrict_clipboard?: boolean;
  enforcement?: boolean;
  threshold?: number;
  cooldown_seconds?: number;
};
export type IntegritySummary = {
  enabled: boolean;
  policy?: IntegrityPolicy;
  count?: number;
  reviewRequired?: boolean;
  reviewCycle?: number;
  overlap?: boolean;
  acknowledged: string[];
};
export function appendObservation<T extends IntegrityObservation>(
  queue: T[],
  event: T,
  limit = 200,
) {
  if (queue.some((e) => e.eventId === event.eventId)) return queue;
  return [...queue, event].slice(-limit);
}
export function acknowledgeObservations<T extends IntegrityObservation>(
  queue: T[],
  ids: string[],
) {
  const accepted = new Set(ids);
  return queue.filter((e) => !accepted.has(e.eventId));
}
export function isCalculatorOrEditable(target: EventTarget | null) {
  return (
    target instanceof Element &&
    Boolean(
      target.closest(
        '[data-calculator],input,textarea,select,[contenteditable="true"]',
      ),
    )
  );
}
