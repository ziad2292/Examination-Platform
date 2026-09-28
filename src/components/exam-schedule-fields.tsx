"use client";

import { useEffect, useRef } from "react";

function browserOffset(value: string) {
  if (!value) return new Date().getTimezoneOffset();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().getTimezoneOffset() : date.getTimezoneOffset();
}

export function ExamScheduleFields() {
  const startOffsetRef = useRef<HTMLInputElement>(null);
  const endOffsetRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const currentOffset = new Date().getTimezoneOffset();
    if (startOffsetRef.current) startOffsetRef.current.value = String(currentOffset);
    if (endOffsetRef.current) endOffsetRef.current.value = String(currentOffset);
  }, []);

  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <label className="block">
        <span className="label">Opens</span>
        <input
          className="field"
          name="scheduledStartAt"
          type="datetime-local"
          required
          onInput={(event) => {
            if (startOffsetRef.current) {
              startOffsetRef.current.value = String(browserOffset(event.currentTarget.value));
            }
          }}
        />
        <input ref={startOffsetRef} name="scheduledStartOffset" type="hidden" defaultValue="0" />
      </label>
      <label className="block">
        <span className="label">Closes</span>
        <input
          className="field"
          name="scheduledEndAt"
          type="datetime-local"
          required
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
