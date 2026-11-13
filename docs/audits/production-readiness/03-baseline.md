# Functional and performance baseline

Baseline captured November 7–9, 2026, before application remediation. The starting worktree already contained extensive uncommitted feature work. No reset, deployment, production mutation, or shared database reset was performed.

## Executed baseline

| Check | Observed result |
|---|---|
| ESLint | Passed, zero warnings |
| TypeScript | Passed |
| Vitest | 62 passed in 15 files |
| Production build | Passed using `.next-audit`, Next 16.3.6, webpack |
| Database characterization | 374 assertions passed in 17 files |
| Edge browser E2E | 22 passed, 1.1 minutes |
| HTTP page samples | 200 successful requests across 10 routes |
| Dependency audit | 16 affected packages, 1 critical, 4 high, 11 moderate |

The first sandbox build failed with Windows EPERM. The separate audit build succeeded with filesystem/process permission. Next added its generated audit type directories to tsconfig automatically. Those generated inclusions are tooling changes, not application behavior changes.

## Preserved rules

Database tests exercise active-account and role restrictions, teacher ownership, explicit exam assignment, multiple teacher links, registration approval, hidden results, immutable question delivery after publication, retakes and prior history. The lifecycle suite exercises persisted section expiry, sequential modules, early break completion, late-answer rejection, idempotent submission and grading. Concurrency tests exercise imports, administrative mutations and integrity deduplication. Raw evidence is under `evidence/before-*.tap`.

Browser tests exercise draft creation/deletion and duplication, all four viewport widths (390, 768, 1366, 1920), assignment-driven screens, pending registration and email approval, randomized answer mapping, refresh and autosave, result visibility, integrity events/review, monitoring disabled, and calculator fallback. Fullscreen is intentionally absent. Concurrent browser sessions remain allowed. Monitoring must never change grades or submit an attempt.

## Measurement method

`scripts/audit/browser-baseline.mjs before` uses headless Microsoft Edge against `next start` on localhost port 3005. Viewport 1366×900, no network/CPU throttle, 20 sequential authenticated full-document GETs per route. Login time is excluded. HTTP samples include body consumption; browser navigation TTFB and paint metrics are separate samples. LCP is observed for 800 ms after load. CLS is a short lab sample. These are not field Core Web Vitals. INP has not been measured. p99 with 20 samples is effectively the maximum and is not a robust tail estimate.

Machine reported 32 logical CPUs and 34,029,125,632 bytes RAM, Node 22.17.1. Docker reports a 15.46 GiB memory ceiling. Database snapshot had 27 public tables, approximately 9 profiles, 4 exams, 5 attempts, 17 answers. Counts are pg_stat estimates. Additional browser fixture data is temporary. Source and dependencies are described in the architecture report.

Raw measurements are `evidence/before-browser.json`. Initial route p95 milliseconds were 37.59 home, 17.66 login, 95.55 teacher, 85.90 monitor, 48.59 student, 43.54 profile, 67.76 admin overview, 54.62 create user, 69.50 accounts, 52.97 students. No measured route overflow or JavaScript page errors. All sampled pages lacked robots metadata. Static build assets totalled 1,550,214 bytes; route script payloads were roughly 137–213 KB encoded.

## Database isolation and limitations

`scripts/audit/database-baseline.ps1 before` creates a randomly named local database, copies schema and explicit grants, seeds disposable records, runs every SQL test, then drops only that database. It excludes managed-role default-privilege statements that the local postgres user cannot restore. It proves tests against the current applied schema, not full migration replay or production role ownership parity. Concurrency tests use local dblink. No production seed/reset is executed.

Local PostgreSQL had 43 connections with max_connections 100. An idle snapshot showed PostgreSQL around 256 MiB and 5.34% CPU, REST 173 MiB and 2.66%, Realtime 264 MiB and 1.52%. These are snapshots, not load profiles. Existing dev/preview processes and desktop activity make small latency differences noisy.

50/100/200-student write workloads, sustained soak/stress, distributed Realtime fan-out, autosave/submission latency distributions, isolated grading timing, real-device INP, production networking, backup restoration and production configuration have not been established. No capacity or production-readiness claim follows from these small local tests. The shared local Docker engine and 100-connection limit require a separate controlled staging workload before scaling claims.
