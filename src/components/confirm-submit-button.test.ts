import { describe, expect, it } from "vitest";
import { confirmationAccepted } from "./confirm-submit-button";

describe("confirmationAccepted", () => {
  it("keeps state unchanged when confirmation is cancelled", () => {
    expect(confirmationAccepted(false)).toBe(false);
    expect(confirmationAccepted(false, "Exam title", "Exam title")).toBe(false);
  });

  it("accepts normal confirmation and exact destructive confirmation text", () => {
    expect(confirmationAccepted(true)).toBe(true);
    expect(confirmationAccepted(true, "Exam title", "Exam title")).toBe(true);
    expect(confirmationAccepted(true, "Exam title", "exam title")).toBe(false);
  });
});
