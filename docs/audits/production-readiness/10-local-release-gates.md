# Supplemental local release checks — November 10, 2026

This supplement closes local verification gaps identified in the original nine reports. It supersedes their earlier statements that fresh replay, clean installation and distinct-student database workloads had not been executed. Production configuration, hosted recovery and full application load remain separate gates.

## Fresh migration replay

Created a disposable Postgres container from `public.ecr.aws/supabase/postgres:17.6.1.166`, with network mode `none`, no published ports, 2 CPUs, 2 GiB RAM and max_connections 250. Existing local Supabase was used only to read managed Auth/Storage schema definitions. No application schema or data was copied into the new public schema.

The base database image lacks the complete Storage service schema. The harness restores managed schema definitions/constraints, excluding application triggers/policies, supplies local test grants, then applies every application migration in filename order. All migrations applied successfully. Every database test passed afterward, 374 assertions across 17 files. dblink connections were redirected to password-authenticated loopback inside the disposable container.

Evidence is `evidence/fresh-replay.json` and `replay-*.tap`. The harness is `scripts/audit/replay-isolated.ps1`. This establishes clean application migration order against current managed-schema prerequisites. It does not certify a hosted provider upgrade, live production upgrade, provider IAM parity or backup recovery. No existing migration was edited to make replay pass.

## Bounded concurrent examination workload

`scripts/audit/lifecycle-load.ps1` uses pgbench inside the same network-isolated container. Three cohorts contain 50, 100 and 200 distinct student identities, with matching profiles, teacher links and exam assignments. Each cohort gets a fresh 20-question exam with one ten-minute module. Operations run in phases with 4 pgbench worker threads and one connection per student. Each save phase performs 20 sequential revisions of the same answer per student, with no human think time. Each phase sets the student JWT identity and authenticated database role, so application authorization/RLS and RPC checks execute.

All 8,050 phase transactions completed without database failures. All 350 attempts completed with the expected grade of 1/20 and the expected saved answer/revision 20. This tests persisted correctness under concurrent writes, not a representative question-answer distribution or mixed teacher/student browsing workload.

| Students | Start p95 / p99 ms | Module p95 / p99 ms | Save p95 / p99 ms | Submit p95 / p99 ms |
|---|---|---|---|---|
| 50 | 215.66 / 222.49 | 382.06 / 385.07 | 500.72 / 786.80 | 640.97 / 641.58 |
| 100 | 628.14 / 646.48 | 1154.91 / 1155.56 | 1399.86 / 2778.95 | 1472.67 / 1474.21 |
| 200 | 1217.97 / 1263.30 | 2906.40 / 2910.12 | 6586.39 / 9685.77 | 4692.13 / 4787.60 |

Raw transaction samples were aggregated into `evidence/lifecycle-load.json`; pgbench summaries and per-statement means are `load-*-*.txt`. The 200-student save phase processed 4,000 transactions at 74.87 transactions/second, with zero failed transactions. A snapshot during the 200-student workload showed 198.92% CPU, 663.4 MiB of the 2 GiB limit, 196 database connections and zero lock-waiting sessions at that instant. This demonstrates CPU saturation under the chosen cap, not the absence of all lock contention or a measured peak-memory ceiling.

These measurements include session identity/role setup and RLS-protected ID lookup subqueries in addition to RPC execution. They exclude HTTP, Auth service latency, PostgREST pooling, Next rendering, heartbeats, teacher monitoring, breaks, network failures and third-party services. The burst workload has no think time. It is deliberately harsher than normal individual answer pacing, but cannot establish production throughput. No application/database performance change was introduced between the cohorts, so this is capacity characterization, not a claimed optimization gain.

**Finding SCALE-02 — High measured performance risk.** A 2-CPU database cannot provide consistently low save latency under this 200-client zero-think-time workload. Correctness passed, but save p99 reached 9.69 seconds. Profile statements with pg_stat_statements and compare representative pooled HTTP workloads on deployment-equivalent resources before choosing indexes, query changes or infrastructure sizing. Do not change exam locks or timers merely to improve this benchmark.

## Clean install and CI

An ordinary npm 10.9.2 `npm ci` succeeded in `test-results/audit-install`, installing 421 packages from the exact lockfile without replacing the working dependencies. The earlier resolver crash occurred during dependency updates, not clean installation. The install reported ESLint 9 lifecycle deprecation; an ESLint major upgrade is a separate tooling compatibility task.

The Playwright config now uses the installed Edge executable only on Windows, allowing bundled Chromium on Linux. `.github/workflows/ci.yml` has a separate disposable Supabase/browser regression job. `scripts/audit/ci-e2e.mjs` reads CLI credentials into child-process environment only, builds, starts a local preview, waits for readiness, runs the suite and stops its own preview. It refuses remote Supabase endpoints. No credentials are written into GITHUB_ENV or printed by the runner.

Lint, typecheck and Node syntax checks pass after these additions. The hosted GitHub Actions job has not been dispatched or observed; do not describe it as passing CI until the reviewed changes are pushed and its run succeeds. The existing local Edge/WebKit results remain valid application evidence.

## Remaining external and approved-design gates

* Deployment-equivalent HTTP/Realtime load, teacher dashboards during exams, soak/reconnect and per-operation service metrics.
* Production backup/restore, provider limits, DNS/TLS, secrets, email delivery and alerting verification.
* Durable cross-service Auth/profile failure recovery design.
* The user-deferred pending-save/submission policy review.
* Firefox host launch failure, real-device INP and manual screen-reader assessment.
* Eight moderate development lint-chain dependency advisories; runtime scan is clear as recorded previously.

The disposable container and its anonymous data volume are removed after evidence collection. No production service or existing local data is changed by these checks.
