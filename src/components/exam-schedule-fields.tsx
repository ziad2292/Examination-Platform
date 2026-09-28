"use client";

import { useEffect, useRef } from "react";

function browserOffset(value: string) {
  if (!value) return new Date().getTimezoneOffset();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().getTimezoneOffset() : date.getTimezoneOffset();
}

function isoToLocalInput(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function ExamScheduleFields({
  startAt,
  endAt,
  lockStart = false,
  lockEnd = false,
}: {
  startAt?: string;
  endAt?: string;
  lockStart?: boolean;
  lockEnd?: boolean;
} = {}) {
  const startOffsetRef = useRef<HTMLInputElement>(null);
  const endOffsetRef = useRef<HTMLInputElement>(null);
  const startRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const currentOffset = new Date().getTimezoneOffset();
    if (startOffsetRef.current) startOffsetRef.current.value = String(currentOffset);
    if (endOffsetRef.current) endOffsetRef.current.value = String(currentOffset);
    if (startRef.current && startAt) startRef.current.value = isoToLocalInput(startAt);
    if (endRef.current && endAt) endRef.current.value = isoToLocalInput(endAt);
  }, [endAt, startAt]);

  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <label className="block">
        <span className="label">Opens</span>
        <input
          ref={startRef}
          className="field"
          name="scheduledStartAt"
          type="datetime-local"
          required
          readOnly={lockStart}
          aria-describedby={lockStart ? "opening-time-lock" : undefined}
          onInput={(event) => {
            if (startOffsetRef.current) {
              startOffsetRef.current.value = String(browserOffset(event.currentTarget.value));
            }
          }}
        />
        {lockStart && (
          <span id="opening-time-lock" className="mt-1 block text-xs text-black/45">
            Opening time is locked because attempts exist.
          </span>
        )}
        <input ref={startOffsetRef} name="scheduledStartOffset" type="hidden" defaultValue="0" />
      </label>
      <label className="block">
        <span className="label">Closes</span>
        <input
          ref={endRef}
          className="field"
          name="scheduledEndAt"
          type="datetime-local"
          required
          readOnly={lockEnd}
          onInput={(event) => {
            if (endOffsetRef.current) {
              endOffsetRef.current.value = String(browserOffset(event.currentTarget.value));
            }
          }}
        />
        <input ref={endOffsetRef} name="scheduledEndOffset" type="hidden" defaultValue="0" />
      </label>
    </div>
  );
}
