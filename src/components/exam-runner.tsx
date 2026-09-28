"use client";

/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Cloud,
  CloudOff,
  LoaderCircle,
} from "lucide-react";
import { saveAnswer, submitSection } from "@/app/actions/attempts";
import { CalculatorLink } from "@/components/calculator-link";
import {
  acknowledgePendingAnswer,
  enqueuePendingAnswer,
  parsePendingAnswers,
  type PendingAnswer,
  type PendingAnswerQueue,
} from "@/lib/autosave";
import { formatDuration, remainingSeconds } from "@/lib/exam-state";
import type { Option, SavedAnswer, StudentQuestion } from "@/lib/types";

type SaveStatus = "saved" | "saving" | "offline" | "error";

interface ExamRunnerProps {
  attemptId: string;
  sectionAttemptId: string;
  expiresAt: string;
  examTitle: string;
  sectionTitle: string;
  questions: StudentQuestion[];
  initialAnswers: SavedAnswer[];
}

const options: Option[] = ["A", "B", "C", "D"];

function readPendingAnswers(storageKey: string): PendingAnswerQueue {
  return parsePendingAnswers(localStorage.getItem(storageKey));
}

function writePendingAnswers(
  storageKey: string,
  pending: PendingAnswerQueue,
) {
  try {
    if (Object.keys(pending).length === 0) localStorage.removeItem(storageKey);
    else localStorage.setItem(storageKey, JSON.stringify(pending));
  } catch {
    // A storage failure must not prevent the immediate server save attempt.
  }
}

function removePendingAnswer(storageKey: string, completed: PendingAnswer) {
  const pending = readPendingAnswers(storageKey);
  writePendingAnswers(storageKey, acknowledgePendingAnswer(pending, completed));
}

export function ExamRunner({
  attemptId,
  sectionAttemptId,
  expiresAt,
  examTitle,
  sectionTitle,
  questions,
  initialAnswers,
}: ExamRunnerProps) {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const [seconds, setSeconds] = useState(() => remainingSeconds(expiresAt));
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [answers, setAnswers] = useState<Record<string, SavedAnswer>>(() =>
    Object.fromEntries(initialAnswers.map((answer) => [answer.question_id, answer])),
  );
  const revision = useRef(
    Math.max(0, ...initialAnswers.map((answer) => answer.client_revision ?? 0)),
  );
  const mounted = useRef(false);
  const submitting = useRef(false);
  const storageKey = `summit-pending-${sectionAttemptId}`;
  const question = questions[index];
  const answer = useMemo(
    () =>
      answers[question.id] ?? {
        question_id: question.id,
        selected_option: null,
        marked_for_review: false,
      },
    [answers, question.id],
  );
  const canContinue = answer.selected_option !== null;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const finish = useCallback(async () => {
    if (submitting.current) return;

    submitting.current = true;
    setIsSubmitting(true);
    const result = await submitSection(sectionAttemptId);

    if (!mounted.current) return;

    if (result.ok) {
      router.replace(`/student/attempts/${attemptId}`);
      return;
    }

    submitting.current = false;
    setIsSubmitting(false);
    setStatus("offline");
  }, [attemptId, router, sectionAttemptId]);

  useEffect(() => {
    const updateTimer = () => {
      const timeLeft = remainingSeconds(expiresAt);
      setSeconds(timeLeft);

      if (timeLeft === 0) void finish();
    };

    updateTimer();
    const timer = window.setInterval(updateTimer, 500);
    return () => window.clearInterval(timer);
  }, [expiresAt, finish]);

  const persist = useCallback(
    async (nextAnswer: SavedAnswer) => {
      setStatus("saving");
      const payload: PendingAnswer = {
        sectionAttemptId,
        questionId: nextAnswer.question_id,
        selectedOption: nextAnswer.selected_option,
        markedForReview: nextAnswer.marked_for_review,
        clientRevision: ++revision.current,
      };
      writePendingAnswers(
        storageKey,
        enqueuePendingAnswer(readPendingAnswers(storageKey), payload),
      );

      try {
        const result = await saveAnswer(payload);
        if (result.ok) {
          removePendingAnswer(storageKey, payload);
          if (mounted.current) setStatus("saved");
        } else if (result.retryable) {
          if (mounted.current) setStatus("offline");
        } else {
          removePendingAnswer(storageKey, payload);
          if (mounted.current) setStatus("error");
        }
      } catch {
        if (mounted.current) setStatus("offline");
      }
    },
    [sectionAttemptId, storageKey],
  );

  const updateAnswer = useCallback(
    (changes: Partial<SavedAnswer>) => {
      const nextAnswer = { ...answer, ...changes };
      setAnswers((current) => ({ ...current, [question.id]: nextAnswer }));
      void persist(nextAnswer);
    },
    [answer, persist, question.id],
  );

  useEffect(() => {
    const retryPendingAnswer = async () => {
      const pending = readPendingAnswers(storageKey);
      const queuedAnswers = Object.values(pending).sort(
        (left, right) => left.clientRevision - right.clientRevision,
      );
      if (queuedAnswers.length === 0) return;

      setStatus("saving");
      let retryableFailure = false;
      let permanentFailure = false;

      for (const queuedAnswer of queuedAnswers) {
        try {
          const result = await saveAnswer(queuedAnswer);
          if (result.ok) removePendingAnswer(storageKey, queuedAnswer);
          else if (result.retryable) retryableFailure = true;
          else {
            removePendingAnswer(storageKey, queuedAnswer);
            permanentFailure = true;
          }
        } catch {
          retryableFailure = true;
        }
      }

      if (!mounted.current) return;

      setStatus(retryableFailure ? "offline" : permanentFailure ? "error" : "saved");
    };

    window.addEventListener("online", retryPendingAnswer);
    void retryPendingAnswer();
    return () => window.removeEventListener("online", retryPendingAnswer);
  }, [storageKey]);

  useEffect(() => {
    const handleKeyboardAnswer = (event: KeyboardEvent) => {
      if (!["1", "2", "3", "4"].includes(event.key)) return;
      updateAnswer({ selected_option: options[Number(event.key) - 1] });
    };

    window.addEventListener("keydown", handleKeyboardAnswer);
    return () => window.removeEventListener("keydown", handleKeyboardAnswer);
  }, [updateAnswer]);

  const counts = useMemo(
    () => ({
      answered: Object.values(answers).filter((saved) => saved.selected_option).length,
      review: Object.values(answers).filter((saved) => saved.marked_for_review).length,
    }),
    [answers],
  );

  return (
    <div className="min-h-[calc(100vh-8rem)]">
      <header className="card flex flex-wrap items-center justify-between gap-4 p-4">
        <div>
          <p className="text-xs font-bold uppercase text-black/40">{examTitle}</p>
          <h1 className="font-bold">{sectionTitle}</h1>
        </div>
        <div className="flex items-center gap-2"><CalculatorLink /><div
            className={`rounded-xl px-4 py-2 font-mono text-xl font-bold tabular-nums ${seconds < 300 ? "bg-red-50 text-red-700" : "bg-[#17211b] text-white"}`}
            aria-label={`${seconds} seconds remaining`}
            aria-live="polite"
            role="timer"
          >{formatDuration(seconds)}</div></div>
      </header>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_250px]">
        <section className="card p-5 sm:p-8">
          <div className="flex items-center justify-between gap-3">
            <span className="eyebrow">
              Question {index + 1} of {questions.length}
            </span>
            <button
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold ${
                answer.marked_for_review
                  ? "bg-amber-100 text-amber-900"
                  : "bg-black/5"
              }`}
              type="button"
              onClick={() =>
                updateAnswer({ marked_for_review: !answer.marked_for_review })
              }
            >
              <Bookmark
                size={16}
                fill={answer.marked_for_review ? "currentColor" : "none"}
              />
              Mark for review
            </button>
          </div>

          {question.image_url && (
            <img
              className="mt-6 max-h-[48vh] w-full rounded-xl border border-black/10 object-contain"
              src={question.image_url}
              alt="Question reference"
            />
          )}

          <p className="mt-6 text-lg font-medium leading-8">{question.optional_text}</p>

          <fieldset className="mt-6 space-y-3">
            <legend className="sr-only">Answer choices</legend>
            {options.map((letter) => {
              const text = question[
                `option_${letter.toLowerCase()}` as keyof StudentQuestion
              ] as string;
              const selected = answer.selected_option === letter;

              return (
                <label
                  className={`flex cursor-pointer items-start gap-4 rounded-xl border p-4 transition ${
                    selected
                      ? "border-brand bg-green-50"
                      : "border-black/10 hover:border-black/25"
                  }`}
                  key={letter}
                >
                  <input
                    className="mt-1 accent-[#1d5c45]"
                    type="radio"
                    name={`answer-${question.id}`}
                    value={letter}
                    checked={selected}
                    onChange={() => updateAnswer({ selected_option: letter })}
                  />
                  <span>
                    <b className="mr-2">{letter}</b>
                    {text !== letter && text}
                  </span>
                </label>
              );
            })}
          </fieldset>

          {!canContinue && (
            <p className="mt-5 text-right text-sm font-medium text-black/50">
              Choose an answer to continue.
            </p>
          )}

          <footer className="mt-6 grid grid-cols-[auto_1fr_auto] items-center gap-3 border-t border-black/10 pt-5">
            <button
              className="btn-secondary"
              type="button"
              disabled={index === 0}
              onClick={() => setIndex((current) => current - 1)}
            >
              <ChevronLeft size={17} />
              Previous
            </button>

            <span
              className={`hidden items-center justify-center gap-1.5 text-xs font-semibold sm:flex ${
                status === "offline" || status === "error"
                  ? "text-red-600"
                  : "text-black/45"
              }`}
              aria-live="polite"
            >
              {status === "offline" || status === "error" ? (
                <CloudOff size={15} />
              ) : (
                <Cloud size={15} />
              )}
              {status === "saved"
                ? "Saved"
                : status === "saving"
                  ? "Saving…"
                  : status === "offline"
                    ? "Will retry online"
                    : "Answer not saved"}
            </span>

            {index < questions.length - 1 ? (
              <button
                className="btn-primary"
                type="button"
                disabled={!canContinue}
                onClick={() => {
                  if (canContinue) setIndex((current) => current + 1);
                }}
              >
                Next
                <ChevronRight size={17} />
              </button>
            ) : (
              <button
                className="btn-primary"
                type="button"
                disabled={!canContinue || isSubmitting}
                onClick={() => void finish()}
              >
                {isSubmitting && <LoaderCircle className="animate-spin" size={17} />}
                {isSubmitting ? "Submitting…" : "Submit module"}
              </button>
            )}
          </footer>
        </section>

        <aside className="card h-fit p-5">
          <div className="flex justify-between text-xs font-semibold text-black/45">
            <span>{counts.answered} answered</span>
            <span>{counts.review} review</span>
          </div>
          <div className="mt-4 grid grid-cols-5 gap-2">
            {questions.map((listedQuestion, questionIndex) => {
              const savedAnswer = answers[listedQuestion.id];
              return (
                <button
                  aria-label={`Question ${questionIndex + 1}${
                    savedAnswer?.marked_for_review ? ", marked for review" : ""
                  }`}
                  className={`aspect-square rounded-lg text-sm font-bold ${
                    questionIndex === index
                      ? "bg-brand text-white"
                      : savedAnswer?.marked_for_review
                        ? "bg-amber-100"
                        : savedAnswer?.selected_option
                          ? "bg-green-100 text-brand"
                          : "bg-black/5"
                  }`}
                  type="button"
                  onClick={() => setIndex(questionIndex)}
                  key={listedQuestion.id}
                >
                  {questionIndex + 1}
                </button>
              );
            })}
          </div>
        </aside>
      </div>
    </div>
  );
}
