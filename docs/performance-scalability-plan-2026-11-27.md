# Assessly performance, scalability, and reliability investigation

**Execution update:** The saved-blank-answer fix and new staging tests were carried out on 28 November. See [the execution and load-test report](staging-load-test-2026-11-28.md) for measured results. The assessment below is the original planning baseline.

**Status:** planning baseline as of 27 November; subsequent work is reported separately.
**Source snapshot:** `staging` at `5a5d464`, clean working tree at inspection, 27 November 2026.
**Measured environment:** historical staging Preview backed by Supabase project `ranrlqfsihteuwxhisek`; the currently deployed Preview SHA, hosted migration list, provider settings, and production schema were **not** independently verified in this investigation. Local Vitest: 79 passed in 19 files. No new hosted load run was made.

## 1. Executive decision

The post-`5967df7` hybrid retest completed 100/100 students with no recorded request errors, but used one ten-question module, five browsers, 95 protocol clients, paced login, and one generator. It is a useful staging baseline, not proof that production can support a 100-student full exam. The section page was the slowest measured route at 4.6 seconds p95. The earlier failed run showed PostgREST pool acquisition and statement timeouts, but neither the production incident nor the precise cause of that staging saturation is established.

**P0 correctness gate:** `recalculate_attempt_score` still inserts `ans.selected_option = k.correct_option` into `answer_results.is_correct boolean not null` (`202609280003_attempt_administration.sql`). A saved answer row with `selected_option = null` can therefore yield NULL and abort final grading. Completely absent answer rows do not enter that insert. The existing state-machine test checks unanswered *questions*, not this saved-null-row path. Reproduce with disposable data and cover manual, expired, concurrent, and retake paths before a performance release. Scoring semantics must remain zero credit for unanswered questions.

## 2. Current architecture and effective paths

The application is one Next.js 16.4.5 App Router service with React 19. Supabase provides Auth, PostgREST, PostgreSQL RPCs/RLS, private Storage, and Realtime. Proxy and `getViewer` use verified JWT claims; `getViewer` reads an active profile and is request-scoped with React `cache`. Role layouts and Server Actions call `requireRole`. The student browser has local pending-answer storage and a separate integrity event queue. Server timers, section ordering, grading, and answer revisions reside in PostgreSQL.

The latest relevant definitions, rather than the initial schema, are: `start_exam` in `202611070002_registration_and_delivery_guards.sql`; `start_section` in `202609260001_initial_schema.sql`; `reconcile_section` in `202609260002_harden_state_machine.sql`; `save_answer`, `submit_section`, `finish_section_internal`, and `recalculate_attempt_score` in `202609280003_attempt_administration.sql`; `student_attempt_progress` in `202611270001_student_attempt_progress.sql`. Inspect `pg_get_functiondef` in staging before a SQL change, including grants, triggers, and RLS. No migration after the grading definition was found that replaces `recalculate_attempt_score`.

### Critical-path diagram and source-level call inventory

These are **source counts**, excluding framework internals, redirect follow-up requests, refreshes, retries, and cache effects. Capture actual wire counts in the next staging run.

| Journey | Application path and explicit upstream calls | Serial/parallel and risk |
| --- | --- | --- |
| Login | `src/app/actions/auth.ts` → Supabase Auth → redirect → protected layout | Simultaneous school-IP login and Auth limits unmeasured. |
| Student home | `src/app/student/page.tsx`: exams list, then one `student_dashboard_attempt_summaries` RPC if exams exist | Batched summary replaced old per-exam N+1. |
| Exam detail/start | `src/app/student/exams/[examId]/page.tsx`: exam read, optional integrity preview, attempt summary, retake grant; `src/app/actions/attempts.ts`: `start_exam` RPC | Detail has conditional calls; start redirects to attempt page. |
| Attempt progress | proxy claims; attempt layout active profile and conditional integrity-policy RPC; page `student_attempt_progress` RPC | 1 page-specific RPC after layout; redirects to active section when present. |
| Section start | `startSection` action: active profile, `start_section` RPC, redirect to section page | Authoritative section expiry starts in DB before page becomes interactive. |
| Active section | proxy/layout checks; section-attempt join read → `reconcile_section` RPC → parallel questions and answers reads → optional signed Storage URLs | Serial chain remains. Images add another upstream call. Need first-interactive timing. |
| Answer selection | `ExamRunner` → `saveAnswer` Server Action: role/profile check then `save_answer` RPC; client stores pending payload | Every selection/mark action sends a request. Observe actual burst and retry overlap. |
| Integrity | attempt layout policy; `use-exam-integrity.ts` heartbeat (default 20 s), event batch; three authenticated `/api/integrity/*` handlers | Measure separately and alongside answer saving. |
| Section submit | `submitSection` Server Action: role/profile check, section-attempt lookup, `submit_section` RPC; redirect/refresh | Client `finish()` does not await pending saves; user explicitly deferred any behavioral change. |
| Teacher monitor | `monitor/page.tsx`: exam, attempts with nested sections, assignment count in parallel; then settings and integrity-state reads; 15-second full `router.refresh()` plus Realtime-triggered refresh | Unbounded roster/history payload and full refetch amplification are suspected. |

`src/proxy.ts` calls `getClaims()` for matched requests. `src/lib/auth.ts` calls `getClaims()` again in `getViewer`; `getViewer` is request-memoized, but Proxy and page are separate execution contexts. Thus two claim-verification operations can occur per protected navigation; this is **not** evidence of two Auth network calls under asymmetric JWTs. Measure network requests before changing it. The protected layout's profile check remains required for account suspension.

## 3. Evidence and baseline methodology

Historical source: `docs/staging-load-test-2026-11-27.md`, commit `5a5d464`. The failed 5-browser/95-protocol staging run recorded 41 attempt-progress client timeouts, 81 section-start phase failures including downstream effects, 19 completions, approximately 52 s attempt-progress p95 Vercel wall time versus 0.8 s CPU, four `PGRST003` pool timeouts, and one `57014` statement timeout. The unique affected-student count must be reported separately from phase failures. After `5967df7` and staging-only migration `202611270001`, one repeated hybrid run recorded 100 completions, zero reported request failures, progress p95 1.8 s, section-start p95 1.6 s, section-page p95 4.6 s, save-wave p95 below 0.9 s, submit p95 0.55 s, and no recorded pool/statement timeouts in that window. p50, p99, exact throughput, resource headroom, and first-interactive time were not recorded. These runs were not equivalent full-browser, full-exam workloads.

The November 10 isolated database `pgbench` workload (`10-local-release-gates.md`) completed 8,050 transactions for 50/100/200 student cohorts and persisted expected grades. Under 200 clients and a capped two-CPU database, save p99 reached 9.69 s and CPU reached approximately 199% in one snapshot. That experiment excluded HTTP, Auth, PostgREST pooling, Realtime, images, and teacher monitoring. It does not establish staging or production capacity. The older local browser audit (`05-performance.md`) used 20 sequential samples per route on a small dataset and cannot establish concurrency or real-user Web Vitals.

### Confirmed, suspected, and unverified

| Class | Finding | Evidence / next discriminator |
| --- | --- | --- |
| Confirmed source risk | Saved NULL answer may make grading insert violate `is_correct not null`. | Migration definition and nullable `answers.selected_option`; disposable regression needed to prove reachable UI/DB sequence. |
| Confirmed historical | Pre-fix staging hybrid had PostgREST pool timeouts and poor tail latency. | Staging report/log window; cause of pool pressure unresolved. |
| Confirmed historical | One post-fix hybrid run improved progress and completed all students. | Same report; one repetition and partial browser coverage. |
| Confirmed source | Section page has a serial read/reconcile/parallel-read/optional-Storage waterfall. | `sections/[sectionAttemptId]/page.tsx`; per-step and browser timings needed. |
| Confirmed source | Teacher monitor refreshes full route every 15 s and on Realtime subscribe/change. | `polling-refresh.tsx`, `integrity-monitor.tsx`; traffic cost unmeasured. |
| Suspected | Section question/profile reads and cross-region RTT dominate remaining 4.6 s p95. | Historical slow-step logs; correlate Vercel, Supabase API, DB execution, and region metrics. |
| Suspected | Large rosters/history or integrity writes may contend with exam operations. | Source shape and shared attempt state; representative concurrent run needed. |
| Unverified | Production CPU, pool size, Auth rate headroom, Vercel queuing, costs, and restore time. | Provider metrics/settings and a safe staging comparison needed. |

## 4. Documentation reconciliation

| Document / section | Existing statement | Current evidence | Correction |
| --- | --- | --- | --- |
| `02-architecture.md`, authentication | Proxy calls `auth.getUser()` | `src/proxy.ts` uses `getClaims()` since `5967df7`. | Update to verified claims and distinguish claim verification from Auth network requests. |
| `02-architecture.md`, attempt path | No consolidated progress RPC described | `src/app/student/attempts/[attemptId]/page.tsx` calls `student_attempt_progress`. | Add the RPC and staging-only deployment status. |
| `05-performance.md`, required staging workload | Says fresh full HTTP/Realtime capacity unverified | November 27 staging hybrid exists, but is partial and single-run after fix. | Link the newer report and retain full-exam/Realtime gap. |
| `README.md`, known MVP limits | Says live not-started count uses all profiles | Teacher monitor counts `exam_student_assignments`. | Replace outdated limit. |
| `README.md`, results | Says immediate student scores deferred | Exam-level result visibility and masked summary RPCs exist. | Describe current visibility policy. |
| `docs/DEPLOYMENT.md`, staging | Says no staging project exists as of Nov 13 | Nov 27 report targets project `ranrlqfsihteuwxhisek`. | Replace historical setup step with current verification instructions. |
| `README.md`, load test | Describes only 70-account k6 script | `scripts/load/real-exam-staging.mjs` and hybrid report exist. | Link current harness, scope, and hard staging guard. |
| `02-architecture.md`, structural debt | Says dashboard N+1 needs profiling | `202611100001_student_dashboard_summaries.sql` and student page batch it. | Mark resolved; profile remaining routes. |

## 5. Priority backlog and decision gates

Expected benefits are hypotheses, **not achieved improvements**. All SQL work requires effective-definition/RLS review and disposable staging tests first.

| Priority / optimization | Current evidence and affected code | Proposed change; benefit and effort | Safety tests, acceptance, rollback |
| --- | --- | --- | --- |
| **P0: blank-answer grading gate** | Nullable `answers.selected_option`; `recalculate_attempt_score` in `202609280003_attempt_administration.sql`; `answer_results.is_correct not null`. | Reproduce saved-null case, then use an additive migration replacing only the effective scoring function if confirmed. Expected: reliable completion for blank/partial responses. Small–medium. | pgTAP manual/expiry/concurrent/retake/regrade/hidden results; exact previous nonblank scores and answer history unchanged. Roll back app-independent function only with verified compatible definition, otherwise forward fix. |
| **P0: correlated staging baseline** | Existing run has p95 and sparse slow-step logs, not resource/time breakdown. `exam-performance.ts`, load harness. | Add privacy-safe request correlation and browser timing; capture Vercel/API/Auth/DB/Storage/Realtime over same time window. Expected: identify limiting resource. Medium. | No answer/PII logging, bounded sampling; no exam correctness changes. Disable diagnostics by config if overhead/volume grows. |
| **P1: section first-interactive path** | 4.6 s p95 after fix; serial section/reconcile/data/Storage chain. | Profile each hop and then parallelize only independent reads or create a narrowly authorized read RPC if measured. Target section usability p95 ≤2 s, p99 ≤4 s; medium–large. | Preserve expiry, question sequence, RLS, image privacy, keys isolation; compare identical workloads. Revert compatible app query path if worse. |
| **P1: full-route teacher monitor amplification** | 15 s router refresh plus Realtime refresh; nested all-attempt payload. | Measure request volume at 1/5/10 monitors; then bound roster, reconcile periodically, apply targeted summary updates. Expected lower reads and steadier tails; medium. | Teacher isolation, no missed flags/updates, reconnect recovery; feature-gate incremental mode and restore polling on regression. |
| **P1: autosave/submission correctness decision** | `ExamRunner.finish()` can call submit while saves remain pending; user deferred behavior change. | Measure frequency and loss scenarios; prepare separate policy proposal. No implementation until approval. Medium. | Deadline/revision/equal-revision/duplicate-device tests required; no timer adjustment. |
| **P2: targeted SQL/index tuning** | Historical pool waits and local CPU saturation; no query-level proof for an index. | Use staging `pg_stat_statements`, locks, `EXPLAIN (ANALYZE, BUFFERS)` on read-only representative queries, then change only proven hotspots. Variable benefit/effort. | RLS/transaction parity and before/after p95/p99, writes, size; drop new index or restore previous function only after compatibility check. |
| **P2: login burst resilience** | Current test paced sign-ins by 2.7 s from one IP. | Measure 25/50/100 simultaneous school-network logins and Auth limits; tune client backoff/operational entry pacing only if needed. Medium. | No weaker verification/rate limits; rollback client retry change. |
| **P2: assets/Desmos** | Full browser/image/calculator workload absent. | Measure LCP/INP/CLS, signed-image time and calculator initialization; lazy-load where safe. Medium. | No future-module prefetch, private asset leakage, or answer-key exposure; revert asset loading change. |
| **P3: infrastructure scaling** | Staging/production compute and region details not aligned or fully captured. | Align regions or increase measured saturated resource only after equivalent A/B runs; cost from live provider quotes. Medium operational effort. | Backup/restore, cost cap, runbook, repeat workload, rollback/resize plan. |

Do not add Redis, a queue, direct student DB connections, generalized result caches, longer timeouts, weaker locks/RLS, or a frontend rewrite without measured need. Do not change when the authoritative timer starts as a latency fix; that is a separate business decision.

## 6. Observability and measurement contract

Assign a correlation ID at the request boundary, pass it through action/route step logs, and expose a non-sensitive ID in diagnostics. Record operation name, duration, status/error class, upstream service, and a sampled request-size bucket. Do not record tokens, emails, names, answers, keys, question content, arbitrary URLs, or unbounded identifiers in metrics. Browser Performance API marks should record click, navigation start, response, first question paint, and first usable interaction; compare these with persisted `started_at`/`expires_at` and remaining time. Track attempts with no image separately from image-heavy sections.

During each staging run capture p50/p95/p99 wall and CPU, throughput, 4xx/5xx, retries, timeouts, unique affected students, Auth calls/rate limits, PostgREST pool wait, SQL execution/lock wait, CPU/memory/connections/I/O, Storage and Realtime volume, generator CPU/network, and answer/grade correctness. Vercel logs/observability cover function and edge; Supabase metrics/logs cover Auth/PostgREST/DB; OpenTelemetry could provide trace correlation; Grafana Cloud is optional for durable dashboards/alerts. Select the smallest instrumentation that answers a specific question and cost it against expected event volume.

Alert on failed saves, submission/grading errors, sustained p95/p99 degradation, pool acquisition/statement timeouts, Auth throttling, database CPU/connection saturation, lock waits, and teacher monitor staleness. Alerts need an owner and tested delivery; a dashboard alone is not an operational response.

## 7. Safe staging experiments and acceptance

Extend `scripts/load/real-exam-staging.mjs`, keeping its fixed staging project/Preview guard and disposable cleanup. Do not run against production. Verify live target, deployed SHA, migration list, environment/region/compute, backup/restore, and a known-good rollback before each acceptance campaign. Preserve raw run artifacts with UTC timestamps and configuration, without secrets.

Progress 1 → 25 → 50 → 100 → 150 → 200 students. Repeat each critical workload at least three times with independent disposable fixtures. Separate 100-browser, protocol, and hybrid measurements; distribute generators and check their saturation. Cover simultaneous school-IP login, starts, a four-module/98-question/ten-minute-break exam with images, Desmos, autosave, integrity and teacher monitors; multiple exams; blank/partial answers; simultaneous submits; refresh/offline/replay; multiple tabs; Realtime reconnect; retry storms; deadline/expiry; wrong-role/cross-student access; cold/warm runs; and a full-duration soak. Use representative history volume and report per-operation distributions and unique impacted students. All acknowledged answers, grades, timers, assignments, and access decisions must be asserted from DB state.

Initial proposed p95/p99 targets at 100 students: Auth 1.5/3 s; dashboard 1.5/3; start 1.5/3; progress 1/2; section start 1/2; section usable 2/4; save 0.5/1.5; section submit 1/2; final grade 2/5; monitor initial 2/4; update freshness 3/5. The current 4.6 s section-page p95 is **server/page elapsed**, not proven first-interactive time; the target needs a matching browser measure. Require all eligible students to finish, zero incorrect/lost acknowledged answers, authorization/timer violations, unrecovered critical failures, unexpected 5xx, pool/statement timeouts, deadlocks, and retry storms. Require ≥30% measured headroom in the limiting resource. Set realistic thresholds after baseline if the initial targets conflict with measured network/third-party limits. LCP <2.5 s, INP <200 ms, CLS <0.1 are lab targets under defined device/network conditions, not current real-user results.

## 8. Regression and release sequence

Regression matrix: login/active-role/RLS; assignment/schedule/code eligibility; randomized stable IDs; start/expiry/module order/break; save revisions/equal revision/deadline/reconnect; manual and concurrent submission; blank/partial grading; retake generations; key correction; hidden results; teacher and integrity isolation/incident counts/audit. Run lint, typecheck, unit, clean migration replay, pgTAP, integration, Playwright desktop/mobile, and representative load after each measured optimization. Reject better medians that worsen tail latency, correctness, or security.

Release in small compatible groups: (1) establish staging/backup/restore and baseline, (2) fix proven correctness defect with additive migration and regression tests, (3) measure and improve one path at a time in staging, (4) repeat full-exam acceptance runs, (5) obtain explicit production release approval, (6) apply reviewed backward-compatible migrations before dependent application code, (7) smoke-test with designated accounts outside live exams, (8) watch health and stop on save/grade errors, timeouts, or pool exhaustion. Reverting application code does not reverse migrations; maintain a compatible previous app build and a forward-fix SQL path. No production load or destructive cleanup during live exams.

## 9. Open decisions and first five actions

1. Reproduce and close the saved-null-answer grading risk first, because a fast exam that fails final grading is unacceptable.
2. Verify staging's deployed SHA, effective schema, provider configuration, and isolated recovery so later measurements have a known target.
3. Add bounded correlation and first-question usability timing, then repeat the post-fix hybrid baseline at least three times.
4. Profile the section page waterfall and optimize only its measured dominant wait, preserving the original section expiry.
5. Measure teacher-monitor and integrity amplification during a full exam, then bound only proven hot paths.

The pending-save/submission policy remains a separately approved decision. Production infrastructure spending needs measured resource saturation, live pricing, expected benefit, and a rollback plan. Production approval requires the correctness gate, clean migration/security regression, verified restore, repeated representative staging acceptance, known environment differences, observability/alerts, and a controlled release window. None of those final production gates is claimed complete by this document.
