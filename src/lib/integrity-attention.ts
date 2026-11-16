/** Correlates focus and visibility observations in one document. */
export function createAttentionTracker(
  active: () => boolean,
  emit: (type: "attention_lost" | "attention_returned") => void,
  delay = () => 2000,
) {
  let pending: ReturnType<typeof setTimeout> | undefined;
  let absent = false;
  const cancel = () => {
    if (pending !== undefined) clearTimeout(pending);
    pending = undefined;
  };
  return {
    lost() {
      if (!active() || pending !== undefined || absent) return;
      pending = setTimeout(() => {
        pending = undefined;
        if (active() && !absent) {
          absent = true;
          emit("attention_lost");
        }
      }, delay());
    },
    returned() {
      cancel();
      if (absent) {
        absent = false;
        emit("attention_returned");
      }
    },
    dispose: cancel,
  };
}
