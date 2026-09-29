# Bulk question import from photos

## Architecture

The feature uses a staged-upload workflow:

1. The teacher selects or drops images in `BulkQuestionImport`.
2. The browser validates count, individual/total size, MIME type, file signature, image decodability, and duplicate SHA-256 content.
3. Valid files upload with bounded concurrency to the private `question-images` bucket under:

   ```text
   question-import-staging/{teacher_id}/{batch_id}/{random_uuid}.{ext}
   ```

4. The preview stores only staged metadata, order, and selected answers in local storage. Refreshing restores the same batch through short-lived signed URLs; original `File` objects are not persisted.
5. `commitBulkQuestionImport` authenticates the teacher, validates ownership and immutability again, checks each staged object's server-visible signature through a signed range request, and invokes one PostgreSQL RPC.
6. `bulk_create_questions` locks the module, validates the complete batch and Storage metadata, allocates a contiguous append range, inserts questions and protected keys, records audit items, and marks the batch complete in one transaction.

The images remain at their randomized staged paths after a successful commit. At that point the path is logically final because it is referenced by a committed question. Student reads remain possible only through the existing attempt-scoped signed-URL flow.

## Limits

All browser/application limits live in `src/lib/question-import.ts`; matching defense-in-depth limits are enforced in the migration.

| Limit | Value |
|---|---:|
| Images per import | 50 |
| Size per image | 8 MiB |
| Total batch size | 100 MiB |
| Concurrent browser uploads | 3 |
| Supported types | PNG, JPEG, WebP |

SVG is intentionally unsupported.

## Transaction and ordering

`bulk_create_questions(exam_id, section_id, batch_id, items)` is a `SECURITY DEFINER` function with an empty search path. It:

- requires an authenticated teacher;
- verifies exam ownership and that the target is a module;
- permits only draft or published exams;
- rejects any exam with an existing attempt;
- locks the `exam_sections` row before inspecting or allocating order;
- validates positions, answers, randomized paths, hashes, Storage ownership, MIME types, per-file size, and total size;
- appends after the current maximum while holding the module lock;
- inserts all `questions`, all `question_keys`, batch items, and completion metadata in the same transaction.

The existing `(section_id, question_order)` unique constraint is the final ordering guard. The section-row lock serializes individual question creation and independent bulk imports, so `MAX(question_order) + position` is safe inside this specific locked transaction.

If any insert or validation fails, PostgreSQL rolls back the function call. No partial questions, keys, or batch items remain.

## Idempotency

The browser creates one UUID `batch_id` before upload and retains it through retries and refreshes. `question_import_batches.id` is the idempotency key.

- The first caller inserts a pending batch row and holds its row lock.
- Concurrent callers using the same ID serialize on the primary key/row lock.
- A completed retry returns the existing question IDs and count without inserting anything.
- A lost response can therefore be retried with the same preview and batch ID.
- Reusing an ID for another teacher, exam, or module is rejected.

## Cleanup and cancellation

- Removing a preview item deletes its staged object through an authenticated Server Action.
- Cancelling deletes every uploaded object in the batch and clears the local draft.
- If removal happens during upload, the item is marked cancelled and the upload completion path immediately deletes the object.
- A confirmed database validation/constraint failure triggers compensating deletion for the full staged path list.
- If the commit result is uncertain because the database or network cannot be reached, images are deliberately retained and the UI asks the teacher to retry the same batch. This avoids deleting images after a transaction that may actually have committed.

A browser process can be terminated before it sends cleanup. Production operations should schedule a daily Storage cleanup job for unreferenced objects under `question-import-staging/` older than 24 hours. The job must exclude paths referenced by `questions.image_path` and completed batches. This is the only deferred-cleanup case; it is bounded to the private bucket and those objects are readable only by their owning teacher until committed.

## Security model

- Server Actions re-authenticate the caller and return only status/count information.
- The transactional RPC repeats role, ownership, module, status, attempt, path, and file-metadata validation.
- RPC execution is revoked from `public` and `anon` and granted only to `authenticated`; the function still checks the teacher role.
- Storage insert/update/delete policies allow a teacher only their own staging prefix or paths under an exam they own.
- Staged objects are private and readable only by the owning teacher.
- Committed objects retain the existing owner-or-student-with-attempt read policy.
- Import batch tables have RLS; only the creating teacher/owner can read them. No direct insert/update/delete policies exist.
- Correct answers are inserted only into `question_keys`; they never appear in question rows, Storage metadata, filenames, signed URLs, or action results.
- Original filenames are React-escaped, length-limited audit metadata. Object names are UUIDs and never use teacher filenames.

## Reliability and UX

- Uploads use three workers rather than unlimited or serial requests.
- Completion status is shown per image; the final button remains disabled while files upload, validation fails, or answers are missing.
- SHA-256 duplicate detection is scoped to the current batch only.
- Move-up/down controls permit deterministic reordering during upload.
- Answer buttons use native radio controls and are keyboard accessible.
- Local draft persistence restores uploaded/in-flight staged paths after refresh.
- Import progress reports the exact question count rather than a generic spinner.

## Tests

- `src/lib/question-import.test.ts`: limits, batch shape/order, duplicate content, and file signatures.
- `supabase/tests/bulk_question_import.sql`: 30-image happy path, keys, append order, retry idempotency, separate batches, validation rejection, Storage rejection, student denial, RLS isolation, wrong ownership, transaction rollback, immutability, and archived exams.
- `supabase/tests/bulk_question_import_concurrency.sql`: real two-connection retries with the same batch ID and simultaneous independent batches against one module.
- Existing RLS, authorization, state-machine, autosave, timer, grading, and build suites remain mandatory regressions.

## Known limitations

- Decodability is checked in the browser; the server verifies trusted Storage metadata and the actual file signature. Full server-side raster decoding is intentionally avoided to prevent a large native image-processing dependency.
- Preview persistence cannot restore a local file that never reached Storage. It restores uploaded/in-flight paths and clearly marks unavailable objects for removal.
- Immediate cleanup cannot be guaranteed if the browser is killed mid-upload; use the documented 24-hour private-staging cleanup job.
