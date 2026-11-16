# Database and infrastructure review

## Schema and query evidence

27 public tables cover profiles, student-teacher/exam links, exams/sections/questions/keys, attempts/answers/results, imports, audit/cleanup jobs and integrity policy/events/reviews. Foreign keys and uniqueness protect relationships and retries. `evidence/catalog.txt` records RLS, 63 indexes, representative plans and local connection settings without student contents.

The student exam-list query took 1.144 ms and its latest-attempt summary 0.421 ms on the tiny local dataset. A sequential scan across four exams is appropriate and is not evidence for a new index. The questions table has both a unique `(section_id, question_order)` index and a similarly ordered ordinary index. This is a candidate redundant-index review, not a measured write bottleneck; neither is dropped during this audit.

Student dashboard request fan-out is confirmed in source. Profile/history and monitoring queries need larger fixtures to evaluate filtering, pagination and RLS helper cost. Do not replace scoped RPCs with direct reads of score-bearing attempt rows. Start-exam serialization locks the shared exam row; save/submit/integrity lock attempt state. Correctness is covered by current tests, throughput is not established under mass starts/submissions.

## Jobs and retention

Local catalog confirms active cron `assessly-integrity-retention` at `17 3 * * *`; the latest function reads the configured retention policy and preserves aggregates/review history. Realtime publication contains only summary state. Hosted job execution history, dead-letter/retry behavior and production retention completion are not inspected. Storage cleanup/duplication reconciliation are documented operations without a verified deployed worker in this audit.

## Deployment and recovery

CI runs lint, typecheck, unit/build and local Supabase DB tests. It does not deploy schema changes or run browsers. Next application deployment alone does not apply Supabase migrations. Existing deploy instructions require a reviewed `supabase db push`, separate environment configuration and no production seed data.

This audit adds no migrations and changes no production configuration. The database baseline clones the current local schema, so a fresh full migration replay remains an independent release gate. Existing uncommitted migrations must be reviewed together with their matching application release. Back up first and favor forward fixes; rollback SQL that drops new history/relationships is unsafe.

The local database had max_connections 100 and 43 active/idle connections at inspection. Docker's local memory ceiling is approximately 15.46 GiB. No capacity claim is valid from those limits alone. Measure pooler behavior, database locks, slow queries, function duration, autosave latency and Realtime reconnects in staging with isolated fixtures and deployment-equivalent resources.

Define owner-approved recovery-point and recovery-time objectives, verify hosted backup/PITR settings, restore a backup into a separate project, and rehearse code/schema rollback. Add actionable alerts for save failures, request errors, long locks, connection saturation and cleanup backlog. No cloud infrastructure or billing change was made.

**November 10 update.** Fresh application migrations and all 374 database assertions now pass in a separate network-isolated container bootstrapped with managed Auth/Storage schemas. A browser CI job has been added but has not yet run on GitHub. See the supplemental report for the measured 50/100/200-student database workload and the remaining production-equivalence limitations.
