import { describe, expect, it } from "vitest";
import {
  acknowledgePendingAnswer,
  enqueuePendingAnswer,
  parsePendingAnswers,
  type PendingAnswer,
} from "./autosave";

const answer = (questionId: string, clientRevision: number): PendingAnswer => ({
  sectionAttemptId: "2b810577-f1c6-4634-b376-66ab6bb185e3",
  questionId,
  selectedOption: "A",
  markedForReview: false,
  clientRevision,
});

describe("offline answer queue", () => {
  it("preserves answers for multiple questions", () => {
    const first = answer("50000000-0000-0000-0000-000000000001", 1);
    const second = answer("50000000-0000-0000-0000-000000000002", 2);
    const queue = enqueuePendingAnswer(enqueuePendingAnswer({}, first), second);

    expect(Object.keys(queue)).toHaveLength(2);
  });

  it("does not let an older response remove a newer queued answer", () => {
    const questionId = "50000000-0000-0000-0000-000000000001";
    const older = answer(questionId, 3);
    const newer = answer(questionId, 4);
    const queue = enqueuePendingAnswer(enqueuePendingAnswer({}, older), newer);

    expect(acknowledgePendingAnswer(queue, older)[questionId]).toEqual(newer);
    expect(acknowledgePendingAnswer(queue, newer)).toEqual({});
  });

  it("recovers safely from corrupt or malformed browser storage", () => {
    expect(parsePendingAnswers("{not-json")).toEqual({});
    expect(parsePendingAnswers(JSON.stringify({ injected: { clientRevision: 1 } }))).toEqual(
      {},
    );
  });

  it("migrates the previous single-answer storage format", () => {
    const legacy = answer("50000000-0000-0000-0000-000000000001", 2);
    expect(parsePendingAnswers(JSON.stringify(legacy))).toEqual({
      [legacy.questionId]: legacy,
    });
  });
});
