# Summit SAT QA, Security, and Reliability Report

Date: 2026-09-26
Environment: local Next.js production build with local Supabase
Scope: application code, Server Actions, PostgreSQL schema/RPCs, RLS, Storage policies, browser flows, and load-test artifacts

## Executive summary

The local release candidate passed 13 unit tests and 54 database/RLS/state-machine assertions. A complete teacher-to-student-to-teacher browser flow and a second disrupted multi-section attempt also passed with no browser console warnings or errors.

No known Critical finding remains. Six High-severity failures were found and fixed: unreliable offline autosave, stale-page timer enforcement, unsafe lifecycle transitions, teacher mutation paths that could bypass database invariants, student-accessible question media/content paths, and timezone-ambiguous scheduling. Medium findings for cross-section review ordering and missing baseline security headers were also fixed.

This is suitable for a controlled staging pilot, but not yet an unconditional production approval. The supplied 70-user and 100-user k6 suites still need to run against the intended staging deployment, and the browser/device matrix, sleep/resume behavior, and managed Supabase configuration need verification outside the local environment.

## Verified state machine

```text
exam
draft -> published -> closed -> archived
                 \--------------> archived (only with no active attempts)

exam_attempt
not present -> in_progress -> completed

section_attempt
not present -> in_progress -> submitted
                           \-> expired
```

Database guards reject reverse or skipped transitions, starting a later section early, changing terminal section attempts, changing completed attempts, and archiving an exam with an active attempt. `start_exam`, `start_section`, and `submit_section` are idempotent for safe retries.

## Test matrix

| ID | Scenario | Setup | Expected | Actual | Result | Severity | Fix / regression reference |
|---|---|---|---|---|---|---|---|
| AUTH-01 | Invalid credentials | Submit incorrect local credentials | Friendly message; no schema detail | Friendly invalid-credentials alert; no console error | Pass | High (original report) | Production-safe auth error mapping; browser regression |
| AUTH-02 | Student/teacher row isolation | Execute queries with real JWT claim contexts | Student A cannot see or alter Student B; teacher limited to owned exams | 22/22 authorization assertions passed | Pass | Critical | `supabase/tests/authorization.sql` |
| AUTH-03 | Anonymous RPC/data access | Use `anon` role directly | No protected reads or transition RPC execution | Denied | Pass | Critical | Explicit RPC revokes; `authorization.sql` |
| AUTH-04 | Forged IDs | Submit IDs owned by another actor | RLS/RPC ownership checks reject request | Rejected in integration tests | Pass | Critical | RLS plus guarded RPCs |
| SCHED-01 | Browser-local schedule | Teacher enters Cairo local datetime | Store equivalent UTC instant | 16:00 Cairo stored as 13:00 UTC | Pass | High | Offset-aware parsing; `exam-state.test.ts`; browser + DB check |
| SCHED-02 | Invalid/impossible date | Malformed or impossible local datetime | Validation error, not server exception | Rejected safely | Pass | Medium | `localDateTimeToIso` tests |
| SCHED-03 | Archive during active attempt | Attempt status `in_progress` | Database rejects archive | Rejected | Pass | High | Lifecycle trigger; state test 19 |
| START-01 | Duplicate exam start | Repeat `start_exam` | One attempt returned | One row; repeated call succeeds | Pass | High | Unique constraint/RPC; state tests 5-7 |
| START-02 | Duplicate section start | Repeat `start_section` | One section attempt returned | One row; repeated call succeeds | Pass | High | RPC locking/order checks; state tests 9-11 |
| START-03 | Skip or wrong section | Request later/cross-exam section | Server rejects | Rejected | Pass | Critical | RPC progression checks; state tests 8, 12 |
| TIMER-01 | Live countdown | Start one-minute module | UI ticks without refresh | 0:56 to 0:54 in 2.1 seconds | Pass | High (original report) | Client interval; browser regression |
| TIMER-02 | Refresh/reopen | Refresh active module | Same expiry; timer does not reset | Answer restored and authoritative expiry preserved | Pass | Critical | DB `expires_at`; browser regression |
| TIMER-03 | Stale page after expiry | Force DB expiry, then refresh | Server reconciles and locks section | Redirected to completed attempt | Pass | High | `reconcile_section` RPC; disrupted browser run |
| TIMER-04 | Post-expiry answer | Call `save_answer` after expiry | Reject write | Rejected by database RPC | Pass | Critical | Database-time check; state/RPC coverage |
| AUTO-01 | Normal autosave | Select answer | Save and display status | Saved; refresh restored B | Pass | High | Browser regression |
| AUTO-02 | Rapid/out-of-order writes | Apply higher then stale revision | Highest revision wins | Newest answer retained | Pass | High | Revision policy; state tests 14-16 |
| AUTO-03 | Offline multiple-question queue | Queue writes for multiple questions | Preserve each latest write | Queue preserves all questions/latest revision | Pass | High | `src/lib/autosave.ts`; `autosave.test.ts` |
| AUTO-04 | Rejected Server Action/network loss | Promise rejects while saving | Retain queue and retry on reconnect | Handled without losing queued payload | Pass | High | Catch/retry path; autosave unit tests |
| AUTO-05 | Corrupt storage | Invalid JSON in local storage | Ignore safely; server remains authoritative | Empty safe queue returned | Pass | Medium | `autosave.test.ts` |
| NAV-01 | Continue without selection | Fresh question | Next/Submit disabled | Disabled | Pass | High (original report) | Exam runner guard; browser regression |
| NAV-02 | Select then Next | Answer first of two questions | Next enables and opens Q2 | Passed | Pass | High (original report) | Browser regression |
| NAV-03 | Reopen completed section | Navigate to terminal section URL | No question access | Server redirects to attempt state | Pass | Critical | Server reconciliation/status checks |
| BREAK-01 | Refresh-safe timed break | Start break | DB-based countdown continues | Live timer confirmed | Pass | High | Section attempt expiry |
| BREAK-02 | End break early | Click once/retry safely | Advance to next allowed module | Advanced to Math module | Pass | Medium | Idempotent submit/progression RPC |
| SUBMIT-01 | Manual/repeated submit | Submit section and repeat RPC | One terminal result | Idempotent | Pass | High | State tests 17, 21 |
| SUBMIT-02 | Write after submission | Save answer after terminal state | Immutable | Rejected | Pass | Critical | Trigger/RPC check; state test 18 |
| GRADE-01 | Correct answer | Submit B where key is B | 1/1, 100% | 1/1, 100% | Pass | High | Browser teacher review |
| GRADE-02 | Unanswered questions | Expire final module unanswered | Deterministic total includes unanswered | Attempt completed with deterministic grade | Pass | High | State test 22; disrupted browser run |
| GRADE-03 | Missing key at publish | Module question lacks key | Publishing rejected | Rejected | Pass | Critical | Publish trigger; state test 3 |
| QUESTION-01 | Student answer-key query | Query `question_keys` as student | No rows | No rows | Pass | Critical | RLS; authorization test 5 |
| QUESTION-02 | Student question enumeration | Student without attempt queries questions | No rows | No rows | Pass | High | Attempt-scoped question policy; authorization test 22 |
| FILE-01 | Public image access | Inspect Storage bucket/policy | Bucket private; authorized signed reads only | Private with authenticated policy | Pass | Critical | Migration and `rls.sql` tests 9-10 |
| FILE-02 | Malicious/unsupported upload | Invalid MIME/size/filename | Reject before insert; clean partial upload | Validated and randomized; cleanup on RPC failure | Pass | High | `questionSchema`, upload checks, validation tests |
| EDIT-01 | Publish empty module/exam | Publish incomplete draft | Reject atomically | Rejected | Pass | High | Publish trigger; state tests 1-3 |
| EDIT-02 | Mutate after attempt | Direct table/RPC mutation | Historical content remains locked | RLS/trigger/RPC blocks mutation | Pass | Critical | Guarded creation RPCs/lifecycle triggers |
| DB-01 | Impossible status/score/revision | Direct malformed updates | Constraint/trigger rejection | Rejected | Pass | High | Migration constraints and state tests |
| DB-02 | Partial question creation | Question succeeds but key fails | Whole transaction rolls back | Atomic `create_question` RPC | Pass | High | Database RPC transaction |
| UI-01 | Login/button spacing | Common forms | Clear vertical separation and usable controls | Verified in login, builder, and runner | Pass | Low | Shared form/button spacing |
| UI-02 | Technical production copy | Landing/auth/error surfaces | No schema/stack/internal wording | Friendly copy shown | Pass | Medium | Error mapping and landing rewrite |
| UI-03 | Teacher review ordering | Multiple sections | Section order then question order | Correct deterministic ordering | Pass | Medium | Review sort fix |
| SEC-01 | Baseline response hardening | Request any route | Anti-sniffing, anti-framing, referrer, permissions, COOP; HSTS in production | Configured | Pass | Medium | `next.config.ts`; header check after build |
| SEC-02 | Repository secret scan | Scan source excluding generated/runtime files | No committed credential material | Only placeholders/docs; local generated secrets ignored | Pass | Critical | `.gitignore` covers `.env*` and `supabase/.temp/` |
| PERF-01 | Expected 70-student class | k6 login/start/read/save/submit flow | Thresholds met | Not executed: k6 is not installed | Blocked | High | `load/k6-exam.js`; must run on staging |
| PERF-02 | 100-user burst | k6 burst scenario | Characterize errors/latency | Not executed: k6 is not installed | Blocked | High | `load/k6-exam.js` |
| PERF-03 | Duplicate start burst | 25 VUs, 100 duplicate calls | One attempt for account | Script prepared, not executed | Blocked | High | `load/k6-idempotency.js` |

## Automated coverage

- Unit: timer formatting/calculation, scoring, UTC conversion and validation, autosave queue migration/deduplication/acknowledgement/corruption, and question validation. Result: 13/13 passed.
- Database smoke/RLS: schema, RLS presence, RPC availability, private image bucket, and authorized Storage policy. Result: 10/10 passed.
- Authorization integration: Student A/B isolation, teacher permissions, unauthenticated access, RPC grants, and attempt-scoped question reads. Result: 22/22 passed.
- State machine/RPC: publish invariants, idempotency, progression, revisions, immutability, archival, and grading. Result: 22/22 passed.
- Static and build checks: ESLint, TypeScript, k6 JavaScript syntax, and optimized Next.js build passed.

## Issues fixed

### High: offline autosave could lose answers

Root cause: one local payload overwrote all other queued answers and rejected Server Action promises were not retained. Fix: per-question queue with revisions, synchronous enqueue before network I/O, retry on mount/online, stale acknowledgement protection, and permanent/retryable response handling. Regression: `src/lib/autosave.test.ts` and browser refresh flow.

### High: stale/JavaScript-disabled pages could outlive a section

Root cause: the browser performed the visible countdown, while a stale route did not reconcile against database time. Fix: `reconcile_section` uses database time and the section page invokes it before rendering. Answer and submit RPCs independently enforce expiry. Regression: forced-expiry browser run and state tests.

### High: invalid lifecycle changes and active-attempt archival

Root cause: status fields were insufficiently constrained and archiving could strand active attempts. Fix: legal-transition triggers, terminal-state guards, score/revision checks, archive guard, and idempotent terminal RPCs. Regression: `supabase/tests/state_machine.sql`.

### High: teacher writes could bypass publish/content invariants

Root cause: direct table mutation policies allowed multi-step partial state and bypass paths. Fix: read-only table access plus atomic, ownership-checked `create_section`/`create_question` RPCs and database publish validation. Regression: state and authorization suites.

### High: question content and media were too broadly accessible

Root cause: a public Storage bucket and broad published-content policies allowed enumeration. Fix: private bucket, signed URLs, owner-or-attempt Storage policy, authenticated table policies, and attempt-scoped student question reads. Regression: `rls.sql` and `authorization.sql`.

### High: schedule values depended on server timezone

Root cause: `datetime-local` values contain no timezone. Fix: capture the browser offset for each selected date and convert validated calendar parts to UTC deterministically. Regression: unit tests plus the 16:00 Cairo -> 13:00 UTC browser/database check.

### Medium: review order and response hardening

Teacher review now sorts section first, then question. Global responses now disable framework disclosure and add anti-framing, MIME-sniff, referrer, permissions, opener, and production HSTS headers.

## Manual end-to-end evidence

1. Teacher created `QA Verification 2026-09-26`, added a timed module and keyed question, and published it.
2. Student 5 logged in, started the exam/module, observed a live timer, confirmed Submit was disabled, answered, refreshed, restored the answer, submitted, and completed with 1/1.
3. Teacher results showed the completed attempt and per-question selected/correct values.
4. Student 4 started the seeded multi-section exam, answered both questions, navigated Next, submitted, entered a timed break, ended it early, and started the final module.
5. The final module was forced past expiry in the local database. Refresh reconciled it server-side and completed the exam without client-side bypass.
6. No browser console warning or error was recorded across the production-build flows.

## Remaining risks and required pre-production work

- Run both k6 suites against an isolated staging database with the intended 70 accounts and a 100-user burst. Record p95 latency, error rate, Postgres connections/locks, Auth failures, and duplicate row counts.
- Repeat core flows in current Chrome, Edge, and Firefox at common laptop/tablet widths, 200% zoom, and keyboard-only navigation. This run used the in-app Chromium browser only.
- Perform real suspend/resume and multi-hour offline tests on physical devices. Local forced-expiry validates server authority but not every browser power-management behavior.
- Exercise managed Supabase outage/recovery, connection-pool exhaustion, backup/restore, PITR, alerting, and production log retention. Local containers cannot prove those operational controls.
- Add a deployment-specific CSP with nonces after the hosting platform is selected. Current anti-framing and other headers reduce exposure, but a strong script CSP requires deployment-aware nonce wiring.
- Validate production Auth settings (email confirmation, disabled-user response, refresh-token lifetime/revocation) and Storage signed-URL lifetime in the managed project.
- The application records attempt/section/answer/submission timestamps, but production dispute handling should define immutable audit-log retention and administrator access procedures.

## Production recommendation

Proceed to a controlled staging pilot. The core authorization, timing, autosave, progression, submission, grading, and immutability guarantees are now enforced at the database boundary and have automated regression coverage. Approve real-student production use only after the staging load thresholds pass, the browser/device matrix is signed off, and managed Supabase operational/security settings are reviewed.
