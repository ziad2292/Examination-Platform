import { describe, expect, it } from "vitest";
import { canRemoveExamAssignment, cleanupConfirmationMatches, validSectionDurationMinutes } from "./feature-policy";

describe("feature policy", () => {
  it("locks assignments that already own attempt history", () => {
    expect(canRemoveExamAssignment(true)).toBe(false);
    expect(canRemoveExamAssignment(false)).toBe(true);
  });

  it("validates the shared break/module duration limits", () => {
    expect(validSectionDurationMinutes(1)).toBe(true);
    expect(validSectionDurationMinutes(240)).toBe(true);
    expect(validSectionDurationMinutes(0)).toBe(false);
    expect(validSectionDurationMinutes(240.5)).toBe(false);
  });

  it("requires exact destructive confirmation phrases", () => {
    expect(cleanupConfirmationMatches("exams", "DELETE ALL EXAMS")).toBe(true);
    expect(cleanupConfirmationMatches("exams", "delete all exams")).toBe(false);
    expect(cleanupConfirmationMatches("all", "DELETE ALL STUDENTS")).toBe(false);
  });
});
