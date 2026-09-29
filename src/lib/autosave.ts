import type { Option } from "./types";

export interface PendingAnswer {
  sectionAttemptId: string;
  questionId: string;
  selectedOption: Option | null;
  markedForReview: boolean;
  clientRevision: number;
}

export type PendingAnswerQueue = Record<string, PendingAnswer>;

function isPendingAnswer(value: unknown): value is PendingAnswer {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PendingAnswer>;
  return (
    typeof candidate.sectionAttemptId === "string" &&
    typeof candidate.questionId === "string" &&
    (candidate.selectedOption === null ||
      ["A", "B", "C", "D"].includes(String(candidate.selectedOption))) &&
    typeof candidate.markedForReview === "boolean" &&
    Number.isInteger(candidate.clientRevision) &&
    Number(candidate.clientRevision) >= 0
  );
}

export function parsePendingAnswers(raw: string | null): PendingAnswerQueue {
  if (!raw) return {};

  try {
    const parsed: unknown = JSON.parse(raw);
    if (isPendingAnswer(parsed)) return { [parsed.questionId]: parsed };
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([questionId, value]) => isPendingAnswer(value) && value.questionId === questionId,
      ),
    );
  } catch {
    return {};
  }
}

export function enqueuePendingAnswer(
  pending: PendingAnswerQueue,
  answer: PendingAnswer,
): PendingAnswerQueue {
  const current = pending[answer.questionId];
  if (current && current.clientRevision > answer.clientRevision) return pending;
  return { ...pending, [answer.questionId]: answer };
}

export function acknowledgePendingAnswer(
  pending: PendingAnswerQueue,
  answer: PendingAnswer,
): PendingAnswerQueue {
  const current = pending[answer.questionId];
  if (!current || current.clientRevision > answer.clientRevision) return pending;

  const next = { ...pending };
  delete next[answer.questionId];
  return next;
}
