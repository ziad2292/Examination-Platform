import { describe, expect, it } from "vitest";
import { answerSchema, questionSchema, sectionSchema } from "./validation";

describe("database identifier validation", () => {
  it("accepts deterministic GUIDs used by seeded records", () => {
    expect(
      sectionSchema.safeParse({
        examId: "30000000-0000-0000-0000-000000000001",
        title: "Reading & Writing Module 1",
        sectionType: "module",
        durationSeconds: 600,
      }).success,
    ).toBe(true);

    expect(
      answerSchema.safeParse({
        sectionAttemptId: "2b810577-f1c6-4634-b376-66ab6bb185e3",
        questionId: "50000000-0000-0000-0000-000000000001",
        selectedOption: "A",
        markedForReview: false,
        clientRevision: 1,
      }).success,
    ).toBe(true);
  });
});

describe("question validation", () => {
  const validQuestion = {
    examId: "30000000-0000-0000-0000-000000000001",
    sectionId: "40000000-0000-0000-0000-000000000001",
    text: "Which option is correct?",
    optionA: "First",
    optionB: "Second",
    optionC: "Third",
    optionD: "Fourth",
    correctOption: "A",
  };

  it("rejects empty options and malformed identifiers", () => {
    expect(questionSchema.safeParse({ ...validQuestion, optionA: "   " }).success).toBe(false);
    expect(questionSchema.safeParse({ ...validQuestion, sectionId: "../other" }).success).toBe(
      false,
    );
  });

  it("accepts encoded text without interpreting it", () => {
    expect(
      questionSchema.safeParse({
        ...validQuestion,
        text: '<script>alert("test")</script> 😀',
      }).success,
    ).toBe(true);
  });
});
