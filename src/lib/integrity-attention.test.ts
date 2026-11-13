import { afterEach, describe, expect, it, vi } from "vitest";
import { createAttentionTracker } from "./integrity-attention";

describe("attention qualification and correlation", () => {
  afterEach(() => vi.useRealTimers());
  it("uses the configured attention window", () => {
    vi.useFakeTimers();
    const emit = vi.fn();
    const tracker = createAttentionTracker(() => true, emit, () => 3000);
    tracker.lost();
    vi.advanceTimersByTime(2999);
    expect(emit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(emit).toHaveBeenCalledWith("attention_lost");
  });
  it("ignores a short focus loss and waits two seconds", () => {
    vi.useFakeTimers();
    const emit = vi.fn();
    const tracker = createAttentionTracker(() => true, emit);
    tracker.lost();
    vi.advanceTimersByTime(1999);
    expect(emit).not.toHaveBeenCalled();
    tracker.returned();
    vi.advanceTimersByTime(3000);
    expect(emit).not.toHaveBeenCalled();
  });
  it("counts prolonged absence once until a return", () => {
    vi.useFakeTimers();
    const emit = vi.fn();
    const tracker = createAttentionTracker(() => true, emit);
    tracker.lost();
    tracker.lost();
    vi.advanceTimersByTime(2000);
    tracker.lost();
    vi.advanceTimersByTime(60000);
    expect(emit.mock.calls).toEqual([["attention_lost"]]);
    tracker.returned();
    tracker.lost();
    vi.advanceTimersByTime(2000);
    expect(emit.mock.calls).toEqual([
      ["attention_lost"],
      ["attention_returned"],
      ["attention_lost"],
    ]);
  });
  it("correlates overlapping focus and visibility loss", () => {
    vi.useFakeTimers();
    const emit = vi.fn();
    const tracker = createAttentionTracker(() => true, emit);
    tracker.lost();
    vi.advanceTimersByTime(500);
    tracker.lost();
    vi.advanceTimersByTime(5000);
    expect(emit.mock.calls).toEqual([["attention_lost"]]);
    tracker.returned();
    expect(emit).toHaveBeenLastCalledWith("attention_returned");
  });
  it("cancels observations during breaks, submission and unmount", () => {
    vi.useFakeTimers();
    let active = true;
    const emit = vi.fn();
    const tracker = createAttentionTracker(() => active, emit);
    tracker.lost();
    active = false;
    vi.advanceTimersByTime(2000);
    tracker.lost();
    expect(emit).not.toHaveBeenCalled();
    active = true;
    tracker.lost();
    tracker.dispose();
    vi.advanceTimersByTime(2000);
    expect(emit).not.toHaveBeenCalled();
  });
});
