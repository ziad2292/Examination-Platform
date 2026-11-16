# Assessly feature expansion

Student registration now goes through email verification and Super Admin approval. **Pending approvals** shows application details, verification state, status filters, and pagination. Approval and rejection are audited, and rejection notes are private. Pending and rejected accounts remain inactive at the database layer.

Student Management uses searchable teacher assignments and bulk add/remove actions. A student can belong to several teachers. Exam access still requires an explicit assignment, and teachers retain access only to their own exams. An existing attempt remains available to its student after a teacher link is removed. A new attempt requires a current teacher link and an exam assignment.

**Exam Builder → Settings → Question delivery** controls question randomization before publishing. Each randomized attempt stores its question IDs in delivery order. The runner displays those IDs within the original module and saves answers by question ID. Exam duplication copies the delivery setting. New attempts on the copy receive their own order.

The student profile has four sections for personal information, assigned teachers, exam history, and released grades. Profile reads are scoped to the authenticated student. The history RPC masks unreleased grades before sending its response. Completed attempts offer a **Back to Home** link.

The teacher dashboard uses red for assessment totals and green for published assessments. Admin navigation has distinct icons and a pending request count. Focus and cursor treatments are shared across the workspace. Registration and draft creation retain their inputs on errors. Pending controls cover registration, approval, assignments, exam start, draft creation, and sign-out. Draft creation stores the exam and access code in one transaction and uses a stable request ID for retries.

## Database changes

| Migration | Changes |
|---|---|
| `202611070001_student_access_and_question_delivery.sql` | Approval state and registration trigger, backfilled teacher join table, scoped RLS, attempt question sequence, profile RPCs. |
| `202611070002_registration_and_delivery_guards.sql` | Email verification checks, audited decisions, current assignment requirement for new attempts, and delivery settings on exam duplicates. |
| `202611070003_atomic_exam_drafts.sql` | Teacher-only atomic draft creation with retry protection. |

## Verification

- `npm run lint`, `npm run typecheck`, and the production `npm run build` passed.
- `npm test` passed all 62 unit tests.
- The SQL suite passed 374 assertions in a disposable database seeded with standard fixtures. The expansion suite contributed 47 assertions covering approval, verification, role isolation, teacher links, explicit exam access, randomization persistence, scoring, grade privacy, and draft retries.
- The full Playwright suite passed 22 tests against the local production build. The new browser workflows verified real email confirmation through Mailpit, pending access denial, approval, teacher assignment, the student profile, randomized delivery after refresh, submission, Back to Home, and grade release. Existing exam management and integrity workflows also passed.
- Responsive browser checks covered desktop, laptop, tablet, and mobile widths. The profile screenshots are `test-results/student-profile-mobile.png` and `test-results/student-profile-released-grade.png`.

## Scope and release

Personal information is read-only in the student profile. Approval uses individual review, and the bulk assignment form adds or removes one teacher across the selected students per submission. Questions with implicit ordering dependencies require teacher judgment because the schema has no dependency metadata. The UI uses the existing light theme. The async audit and browser checks cover the workflows above. A control-by-control manual audit across the entire product remains outstanding.

Apply the migrations before releasing the updated app. Enable email signups and email confirmation in the target Supabase Auth project, configure email delivery, and set the production site URL and redirect allowlist. Keep the service-role credential server-side for existing managed-account and cleanup features. The browser fixtures used a valid local service-role key supplied to the test process. The local application’s placeholder service-role setting requires a valid key for managed-account operations.

The migration and email confirmation settings were applied to local Supabase. The production deployment remains pending.
