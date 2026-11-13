# Remediation outcome — November 10, 2026

## Scope and changes

The [finding tracker](11-remediation-tracker.md) accounts for all original audit findings and the two added during verification. The earlier baseline, measurements, and reports remain intact. Changes since that baseline include patched runtime dependencies; validated internal sign-in redirects; recovery from blocked browser storage during answer saving; scoped admin workspace queries; private-route indexing directives; contrast and markup fixes; and a local browser CI runner. The November 10 follow-up made the exam timer stop announcing every second and surfaced failed Auth rollback as an explicit administrator recovery state.

The student dashboard previously made one attempt-summary RPC for each visible exam. It now makes one `student_dashboard_attempt_summaries` RPC for the list of visible exam IDs. The new [versioned migration](../../../supabase/migrations/202611100001_student_dashboard_summaries.sql) returns only each student's latest attempt ID and status. It does not return scores, answers, or teacher data. The existing unique exam/student/generation constraint supports the lookup. No grading, timing, eligibility, assignment, or submission rule was changed.

## Verification

| Check | Result | Limit |
|---|---|---|
| Lint, TypeScript, production Next build | Passed | Local workstation |
| Vitest | 79 passed, 19 files | No production integration |
| Supabase SQL/pgtap in disposable database | 379 passed, 18 files; five new summary assertions | Cloned local schema, not hosted provider |
| Clean migration replay | All 23 migrations and 379 assertions passed in a network-isolated disposable Postgres container | Managed Auth/Storage schema copied from local Supabase; not a hosted upgrade rehearsal |
| Full local Playwright suite | 28 passed on Edge/Chromium | Local seeded Supabase, one browser engine in this final run |
| Dependency security | Earlier runtime scan: zero advisories; eight moderate development lint-chain advisories remained | No new dependency was introduced in this follow-up |
| Accessibility | Earlier ten-route rendered axe scan had zero A/AA findings; countdown live region removed | Manual screen-reader assessment remains |
| Bounded database load | Earlier 8,050 transactions completed with correct grades across 50/100/200-student cohorts | 200-client save p99 was 9.69 seconds on a capped 2-CPU database; HTTP/pooling not measured |

The summary change reduces dashboard request count from `1 + N` to two database requests when a student has `N > 0` visible exams. This is a source-level request-count comparison, **not** a measured latency improvement. Earlier benchmark values and methods remain in [performance measurements](05-performance.md) and [local release checks](10-local-release-gates.md); differing test conditions prevent a defensible before/after percentage for overall page speed or capacity. The migration was applied to the local development database, tested in a randomly named disposable database, and replayed from an empty application schema in an isolated container. It was not applied to production.

The browser suite covered protected role routes, login redirect handling, exam deletion/duplication, integrity settings and incidents, responsive layouts, teacher creation/publishing, student exam participation, autosave with blocked storage, submission/grading, and registration/approval. Database assertions cover authorization, RLS, ownership, state transitions, grades, imports, deletion, and the new batched summary. No test failures remain in these local suites. Hosted CI, Firefox, manual assistive technology, hosted restore, and production-equivalent HTTP/Realtime load were not executed.

## Release and remaining risks

Apply all pending migrations in filename order **before** releasing application code that calls `student_dashboard_attempt_summaries`; deployment of Next.js does not itself apply Supabase migrations. Back up and rehearse the upgrade in staging. The new migration creates one function and grants execute to authenticated users; rollback can restore the previous dashboard query only with a matching application release. Do not drop an already-used function or reset production data as a routine rollback.

The [tracker](11-remediation-tracker.md) identifies unresolved work: durable Auth/profile reconciliation, server-side paging of the admin student roster and account history, CSP staging evaluation, observability/alerts, manual accessibility and browser coverage, and production-equivalent capacity testing. The user chose to defer any pending-save/submission behavior change to a separate approved task. Production readiness for high-stakes concurrent exams is therefore **not certified** by these local results.
