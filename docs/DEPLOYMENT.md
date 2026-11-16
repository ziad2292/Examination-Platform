# Deployment checklist

## Staging gate for the current release

There is no staging project configured as of November 13, 2026. Create a separate Supabase project and a Vercel Preview deployment with separate environment variables and test accounts. Do not link the production project to the staging CLI checkout or run `supabase db reset`, seed files, factory cleanup, or load fixtures against production.

1. Take a production backup using the provider's supported procedure. Verify the backup is usable by restoring it into a **separate, access-restricted project**; remove or anonymize personal data before using it for tests. Record recovery time and the oldest recoverable point. This step requires the project's owner and backup configuration.
2. Apply migrations to staging in filename order from the same reviewed commit, using `supabase db push` only after checking the CLI target with `supabase projects list` and `supabase migration list`. The Next/Vercel deployment does not apply migrations.
3. Deploy the matching application commit to Vercel Preview. Run the local CI suite, then smoke-test account approval, teacher assignment, exam creation/publish, student start/save/break/submit, results visibility, integrity monitoring, and admin access on staging disposable accounts.
4. Configure Vercel function/error alerts and Supabase database/Auth/cron alerts. Exercise at least one alert for a synthetic failure. Assign an owner and a response channel. Check the integrity retention job's recent execution and cleanup backlog.
5. Run staged HTTP workloads with 50, 100, then 200 distinct disposable students. Add five monitoring teachers, answer saves, heartbeats, reconnects, and synchronized starts/submissions. Measure p50/p95/p99 per operation, error and retry rates, database CPU, connection/pool saturation, lock waits, and grading correctness. Stop on sustained errors or unacceptable save delays. Do not run the load suite on production.
6. Promote the reviewed commit and matching migrations only after recording the staging results, restore drill, monitoring exercise, and an owner-approved capacity target. Roll back application code to a version compatible with the already-applied schema; favor forward database fixes over dropping history.

### Capacity decisions

The existing database-only 200-student burst completed correctly but reached **9.69 s p99 answer-save latency** on a capped 2-CPU database. This is a CPU-saturated synthetic workload, not a measured production limit. First measure the full staging path with HTTP and the Supabase pooler. If CPU saturates, increase database compute and repeat the same workload. If connections saturate before CPU, tune pooler and connection limits within provider guidance. If specific SQL dominates, use `pg_stat_statements` and `EXPLAIN (ANALYZE, BUFFERS)` on staging to optimize those queries and indexes. Keep server-authoritative timers, answer revisions, and grading unchanged. Scale the Vercel app tier only if its own function concurrency or latency is the bottleneck.

## Supabase production

1. Create a separate production project; never reuse development.
2. Link the CLI and run `supabase db push` from a reviewed commit.
3. Confirm the `question-images` bucket, MIME restrictions, and 8 MB limit.
4. Create teacher/student accounts through an approved enrollment flow; do not run development seed data.
5. Configure Site URL and allowed redirect URLs for the Vercel domain.
6. Run `supabase test db`, then manually verify student denial for `question_keys`, other students' attempts, and answer writes after expiry.
7. Schedule a daily cleanup job for unreferenced `question-import-staging/` objects older than 24 hours, excluding every path referenced by `questions.image_path` or a completed import batch.
8. Reconcile `storage_cleanup_jobs` and stale non-completed `exam_duplication_jobs`; remove an object only after confirming no question references it.
9. Create production Super Admins through the reviewed process in `USER_ADMINISTRATION.md`; never run local seed credentials in production.

## Vercel

1. Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_APP_URL`, and `APP_TIMEZONE` separately for Preview and Production.
2. Set `SUPABASE_SERVICE_ROLE_KEY` only in the server deployment environment when Super Admin user management is enabled. Never use a `NEXT_PUBLIC_` prefix or expose it to browser code.
3. Use `npm run build` as the build command and Node.js 22.
4. Smoke-test login, image display, start/resume, timeout, completion, and teacher results on Preview.
5. Run the 70-user k6 scenario against staging, record latency/error results, then promote the same commit.

## Release gate

- Migration backup and rollback plan reviewed
- RLS tests passing
- No production secrets in Git or browser bundles
- Exam schedule/timezone verified
- Teacher roster and support contact verified
- Monitoring enabled for Vercel functions and Supabase database/auth errors
- Abandoned bulk-import staging cleanup scheduled and monitored
