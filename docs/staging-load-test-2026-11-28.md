# Assessly staging load test and performance work — 28 November 2026

## Decision

**The 200-student target failed on staging.** Do not use this run to certify production capacity. In a disposable one-module exam, all 200 students signed in and started the module, but 190 section-page requests exceeded the 30-second client timeout. The first answer wave had 41 failures, and only 159 of 200 attempts finished with the expected persisted score. The run recorded 267 failed phase operations in total; these are not 267 distinct students.

The strongest evidence points to saturation in the Supabase/PostgREST data path during a simultaneous section transition. Staging gateway origin latencies reached tens of seconds, and PostgREST emitted pool-acquisition timeouts (`PGRST003`). Vercel function CPU was much lower than wall time on the slow section requests. This does not prove a single internal root cause, but increasing Vercel memory alone is not supported by the measurements.

The small staging database has about 406 MiB of reported total memory. A sample during the overloaded answer wave showed about 84 MiB available and high I/O wait; one metrics scrape itself failed. These are point samples, not a continuous utilization trace. Before a 200-student production exam, raise the **database compute/pool capacity**, keep the application and database in nearby regions where possible, and optimize the section-entry data path. Repeat the same test and a full-browser, full-exam rehearsal after each change. The 100-student hybrid run passed, but a 50-student run was intermittently slow, so neither result guarantees a 100-student live exam.

## Environment and workload

- Tested the Vercel `staging` Preview, deployed from `staging` at `5a5d464`, connected to Supabase project `ranrlqfsihteuwxhisek` in `eu-west-1`. The sampled Vercel function region was `iad1`; the cross-region path adds latency but is not by itself proof of the timeout cause.
- The harness refuses a non-staging Supabase target, creates a disposable teacher, students, one published exam, one 30-minute question module, ten questions and assignments, then deletes the attempts, exam and users. The Vercel Preview target and Supabase project are fixed in the harness. The wrapper checks the branch Preview environment before getting credentials from the already authenticated CLIs.
- Login was paced at 2.7 seconds per student. The exam phase then used simultaneous waves. Five real Edge browser sessions were used for the 25, 50 and 100 cohorts; ten for the 200 cohort. The remaining clients used authenticated HTTP and Supabase RPCs. Browser clients used the actual student UI for navigation, answers and submission; protocol clients used the Next section-start form action but direct RPCs for starting the exam, saving answers and submitting. Answer waves were spaced by eight seconds.
- This is a **hybrid one-module test**, not 200 complete browser journeys through a four-module exam. It omits breaks, private images, the calculator, full integrity traffic, teacher monitoring, a complete exam duration, and an unpaced school login burst. Its results cannot establish production capacity by themselves.

## Results

| Cohort | Persisted correct / total | Section-page p95 | Important observation |
| --- | ---: | ---: | --- |
| 1, browser | 1 / 1 | not a cohort percentile | Initial smoke passed. |
| 25, 5 browsers | 25 / 25 | 1.47 s | No recorded phase failures. |
| 50, 5 browsers | 50 / 50 | 4.76 s | No failures, but student home p95 21.62 s; answer waves reached p95 11–12 s. |
| 100, 5 browsers | 100 / 100 | 3.63 s | No recorded failures; home p95 6.51 s. This variability matters. |
| 200, 10 browsers | **159 / 200** | **30.07 s client cutoff** | 190 section-page timeouts; answer wave 1 had 41 failures; 10 submit failures; 267 failed phase operations overall. |
| 1, protocol, saved blank | 1 / 1 | not a cohort percentile | Verified the migrated grading function returned 9/10 for one saved blank answer. |

The 200 run produced 200 persisted attempt records, but the `correctGrades` check accepted only records with `completed` status and the exact expected score. A timed-out client call can still finish server-side; phase-failure counts therefore cannot be interpreted as final data loss without the persisted grade check. The harness did not retry failed saves, unlike some student-side recovery behavior.

### Correlated provider evidence for the 200 run

- During the section transition, Supabase gateway `edge_logs` showed 190 `section_attempts` reads at 37.85 s p95 origin time and 66 `reconcile_section` calls at 48.39 s p95. These are completed gateway requests in the sampled window, not every request issued by the load client.
- Across the answer window, 1,958 observed `save_answer` gateway requests had 2.07 s p50, **68.89 s p95**, 115.37 s p99 origin time, and 31 HTTP 5xx responses. PostgREST logs had 11 `PGRST003` entries in the same broad window. The client recorded `PGRST003` and 30-second timeouts.
- A partial Vercel invocation sample found 11 completed section GET invocations with 40.58 s p95 wall time and 431 ms p95 CPU. The sample is too small to estimate all 200 Vercel section requests, but the CPU/wall gap is consistent with external waiting.
- One-minute staging metrics samples showed roughly 406 MiB total memory. Available memory fell to about 84 MiB during the overloaded interval. A broad interval ending at 07:18 UTC had about 71% I/O wait among reported CPU time categories and one metrics scrape failed. The minute samples showed 19–21 database connections later in the run and no waiting PgBouncer clients at those exact instants; brief PostgREST pool waits can be missed by that sampling rate.
- Cumulative `pg_stat_statements` data after the first wave showed `save_answer` mean SQL execution around 33.5 ms and max around 2.38 s. It is not isolated to this test, but it is far below gateway p95, supporting investigation of connection/gateway/host waiting rather than only the SQL body.

The 50-student run also showed variable waiting: its 500 observed `save_answer` gateway calls had about 9.47 s p95 origin time. The later 100-student run had about 0.70 s p95 over 976 observed calls. A single successful run is therefore insufficient as a release gate.

## Changes made

- Added `supabase/migrations/202611270002_grade_blank_saved_answers.sql`. A saved answer row with `selected_option = NULL` now grades as false instead of inserting NULL into the non-null `answer_results.is_correct` column. This is an additive function replacement and leaves existing answer, attempt and grade rows intact. **Applied to staging only; not production.**
- Extended `supabase/tests/state_machine.sql` to cover saving a marked blank answer and completing the final module. The full local pgTAP suite could not run because the available local Supabase stack references an unavailable PostgREST image; the new assertion remains in the suite for CI/local environments with the stack.
- Added `scripts/audit/test-blank-grading.ps1`, which runs the migration and focused grading/regrading assertions in an isolated, network-disabled disposable PostgreSQL container.
- Extended `scripts/load/real-exam-staging.mjs` to support up to 200 students, p99 reporting, persisted-score checks and the saved-blank scenario. Added `scripts/load/run-staging.ps1`, `scripts/load/report-vercel.ps1` and `scripts/load/sample-staging-metrics.ps1` for staging-target verification and measurements. Test logs are under ignored `test-results/` locally.

## Verification and remaining gates

Passed: lint, TypeScript typecheck, 79 Vitest tests across 19 files, Next production build, isolated saved-blank grading/regrading test, live one-student saved-blank staging exam, and cleanup verification after the failed 200-student run (`0` test exams and `0` test users remained). The staging migration was applied and its definition checked. The load test itself **failed** its 200-student acceptance gate. Full local pgTAP, full-browser 200-student E2E, full exam lifecycle, teacher monitoring under load, and production capacity verification were **not completed**.

Next work in order:

1. Profile the section-entry calls and PostgREST pool/host metrics at sub-minute resolution. Check the slow route's section-attempt read, reconciliation, question/answer reads, RLS work and private-image signing with request correlation. Preserve server-authoritative expiry and access checks.
2. Reduce section-entry request amplification only after profiling, and align Vercel runtime region with the staging database if deployment settings allow. Measure before and after with the same 200-way transition.
3. Increase staging database compute from the current small shared allocation and retest. Size production for the successful measured workload with headroom; do not infer a precise required tier from this failed hybrid test.
4. Run 200 actual browser clients through a representative multi-module exam, including breaks, answer autosave/retries, integrity traffic and teacher monitoring, then test a realistic login burst. Check persisted attempts, grades and answer revisions after each run.
5. Apply the grading migration to production only through the normal reviewed release process with a verified backup. This test did not change production data or deployment.

The pending-answer/submission race identified in the planning report remains a separate change by the user's explicit decision. This work did not change submission behavior.
