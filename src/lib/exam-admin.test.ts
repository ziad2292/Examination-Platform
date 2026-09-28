import { describe, expect, it } from "vitest";
import { latestAttemptsByStudent, normalizeExamFilters, summarizeLiveStatus } from "./exam-admin";

describe("exam administration filters", () => {
  it("normalizes supported title, status, phase, and date filters", () => {
    expect(normalizeExamFilters({ q: "  Practice  ", status: "archived", phase: "closed", from: "2026-10-01", to: "2026-10-31" })).toEqual({
      titleSearch: "Practice",
      status: "archived",
      phase: "closed",
      dateFrom: "2026-10-01",
      dateTo: "2026-10-31",
    });
  });

  it("drops unsupported and malformed filters", () => {
    expect(normalizeExamFilters({ status: "deleted", phase: "yesterday", from: "10/01/2026", to: "" })).toMatchObject({ status: "", phase: "", dateFrom: "", dateTo: "" });
  });

  it.each(["draft", "published", "closed", "archived"])("accepts the %s status filter", (status) => {
    expect(normalizeExamFilters({ status }).status).toBe(status);
  });

  it.each(["upcoming", "active", "closed"])("accepts the %s phase filter", (phase) => {
    expect(normalizeExamFilters({ phase }).phase).toBe(phase);
  });
});

describe("live attempt summaries", () => {
  it("uses only the newest attempt generation for each student", () => {
    const latest = latestAttemptsByStudent([
      { student_id: "a", generation: 1, status: "expired" },
      { student_id: "a", generation: 2, status: "in_progress" },
      { student_id: "b", generation: 1, status: "completed" },
    ]);
    expect(latest).toEqual([
      { student_id: "a", generation: 2, status: "in_progress" },
      { student_id: "b", generation: 1, status: "completed" },
    ]);
  });

  it("summarizes mixed student states and a no-result roster", () => {
    expect(summarizeLiveStatus(5, [{ status: "in_progress" }, { status: "completed" }, { status: "expired" }])).toEqual({ notStarted: 2, inProgress: 1, completed: 1, problem: 1 });
    expect(summarizeLiveStatus(0, [])).toEqual({ notStarted: 0, inProgress: 0, completed: 0, problem: 0 });
  });
});
