# Exam administration

Teacher administration is implemented through authenticated Server Actions and owner-scoped, security-definer PostgreSQL functions. UI visibility is not an authorization boundary: every mutation rechecks the teacher, exam ownership, lifecycle state, expected version where applicable, and operation idempotency key.

## Lifecycle and editability

| State | Allowed administration |
| --- | --- |
| Draft, no attempts | Edit metadata and schedule, edit content, replace images, duplicate, publish, archive, or permanently delete. |
| Published, no attempts | Edit safe metadata and schedule, edit content, close, archive, or duplicate. |
| Published, attempts exist | Edit title, description, and instructions; extend the closing time; close or duplicate. Opening time, access-code configuration, content, question images, and earlier closing times are locked. |
| Closed | Preserve results; optionally extend the closing time and deliberately reopen, archive, duplicate, or correct an answer key through the audited correction workflow. |
| Archived | Read-only until an explicit restore. An exam with active attempts cannot be archived. |

All timestamps are stored as `timestamptz` in UTC. Forms capture the browser offset, convert to an ISO instant on the server, and render in `APP_TIMEZONE` (default `Africa/Cairo`). Rescheduling never changes an existing `section_attempt.expires_at`; a running section retains the deadline calculated when it started.

Publishing calls the database validation function in the same protected transition. It checks title and schedule, modules and breaks, contiguous section/question order, duration bounds, question text/image presence, answer keys, Storage objects, access-code configuration, and valid break progression. The teacher page displays the same validation result, but bypassing the page cannot bypass the database check.

## Delete, archive, and duplicate

Permanent deletion is limited to an untouched draft with an exact title confirmation. The database transaction verifies there are no attempts, records an audit event, queues referenced image paths, and deletes cascading draft content. Storage is removed only after the database transaction succeeds; failed removals remain in `storage_cleanup_jobs` for retry.

Exams with attempts are archived instead of deleted. Attempts, answers, grading results, and correction history remain available. Restoring an archived exam returns it to `closed` when history exists and to `draft` otherwise.

Duplication uses a staging job and deterministic target Storage paths. Images are copied first, then a single database transaction creates a new draft exam with new section/question IDs, copied ordering, durations, content, images, and protected answer keys. Attempts, answers, results, access codes, scheduling, and audit history are not copied. Retrying the same operation converges on the same draft and image objects.

## Attempt administration

Attempts have a monotonically increasing generation per student and exam. Resetting an active attempt marks the old generation `expired`, preserves its answers/results, and creates one open retake grant. Authorizing a retake for a terminal attempt creates the same kind of grant. The student's next start consumes the grant and creates a new generation linked from the historical attempt.

A teacher may submit an active section or full attempt. These operations lock the attempt, use the shared grading functions, reject future answer writes through terminal status, and are idempotent. Full submission grades before applying the completed-state constraint. Every reset, retake authorization, and manual submission records actor, target, time, reason, before/after state, and idempotency key.

The monitor polls every 15 seconds and shows the newest attempt generation per student: status, current section, start time, last activity, completion time, and terminal score. `not started` is based on all student profiles because the MVP has no exam-enrollment roster.

## Corrections and images

Scores are never directly edited. An answer-key correction requires a different option and a reason, records the previous and corrected key, locks the key/exam, and deterministically recalculates every completed or expired attempt. Duplicate correction requests return the original correction record and do not regrade twice.

Question image replacement is allowed only before the first attempt. The server validates PNG/JPEG/WebP and the 8 MB limit, writes to an operation-key-derived path, and atomically compares the expected old path before updating the question. The old path is queued and removed after commit. A retry reuses the uploaded object and audit event; Storage or stale-editor failures leave the database reference unchanged.

## Audit and concurrency

`admin_audit_events` covers metadata changes, reschedules/reopens, publish/close/archive/restore/delete/duplicate, attempt resets and retakes, manual submissions, image replacement, and answer-key corrections. Audit payloads contain operational metadata only—never credentials, access tokens, or raw student answers.

Rows are locked in stable ownership order for race-sensitive mutations. Optimistic `updated_at` checks reject stale metadata/reschedule tabs. Unique operation keys and partial unique indexes make retryable actions converge. pgTAP dblink tests cover simultaneous reschedules, delete versus edit, archive versus start, duplicate manual submission, reset versus answer save, and duplicate regrading.

## Operational notes and limitations

- Run `storage_cleanup_jobs` reconciliation after a failed Storage removal; acknowledge paths only after successful deletion.
- A duplication job whose client disappears before database completion can leave deterministic target objects. A maintenance job may remove objects belonging to old non-completed duplication jobs after confirming no `questions.image_path` reference.
- Monitoring uses polling, not realtime events, and `last_seen_at` advances on exam start/resume and accepted answer saves.
- Enrollment-specific `not started` counts require a future exam-roster table.
- Content remains immutable after the first attempt. General versioned exam-content corrections are outside this feature; answer-key correction is the one explicit audited exception.
