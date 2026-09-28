# Engineering report

## System design

Summit SAT is a single Next.js application backed by Supabase. Server Components perform initial reads, Server Actions handle authenticated mutations, and narrowly scoped PostgreSQL functions own race-sensitive exam transitions. There is no separate API server, queue, cache, or scheduled job.

## Data and security

All primary keys are UUIDs. `profiles` maps one-to-one to Supabase Auth. Exams contain ordered sections; only module sections contain questions. Correct answers live in `question_keys`, not the student-readable `questions` table. Attempts are unique by `(exam_id, student_id, generation)`, section attempts by `(exam_attempt_id, section_id)`, and answers by `(exam_attempt_id, question_id)`. Retake grants create a new linked generation without deleting prior answers or results.

RLS is enabled on every application table. Teachers can mutate only their exams. Students can read published exam content and only their attempt records. No direct insert/update policy exists for student attempts or answers: security-definer functions validate identity, ordering, expiry, and ownership. Service-role credentials are never used by browser code.

## Timing and reliability

Starting a section atomically stores `started_at` and `expires_at`. The browser renders `expires_at - now`; it does not own elapsed time. Every answer save checks the database clock and rejects expired/closed sections. Submission is idempotent. Refreshing reloads saved answers and the original expiry. A failed save is retained in `localStorage` and retried when connectivity returns.

## Grading

Final section submission grades inside PostgreSQL by joining answers to protected keys, stores per-answer correctness, counts every exam question for the denominator, and completes the attempt. Students have no RLS path to keys or grading rows. Teachers see correct, incorrect, marked, and unanswered questions.

Wrong keys are corrected only through a reasoned administrative RPC. It records immutable correction history and regrades every terminal attempt from saved answers; direct score editing remains unavailable.

## Administration and audit

Exam lifecycle mutations are owner-scoped database functions with row locks, operation idempotency keys, and audit events. Descriptive metadata can remain editable after attempts, while timing/content fields that could invalidate an attempt remain locked. Archive preserves history, deletion is restricted to untouched drafts, and Storage cleanup is post-commit and retryable. See [exam administration](EXAM_ADMINISTRATION.md) for the complete state table.

## Verification layers

- Vitest covers schedule boundaries, expiry math, formatting, and score percentages.
- pgTAP tests assert security-critical tables, RLS, lifecycle rules, grading, and concurrent administration races.
- TypeScript strict mode and ESLint run with zero warnings.
- `next build` verifies production compilation.
- k6 models 70 concurrent students against staging.

## Roadmap

Add immutable content versions, enrollment rosters, single-tab leases, CSV export, question-bank metadata, adaptive routing, score estimation, and longitudinal analytics only after the core exam flow has production evidence.
