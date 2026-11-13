# Assessly production release candidate — November 13, 2026

## Candidate and local verification

- Branch: `codex/feature-production-superadmin-bootstrap`
- Candidate commit: `2d0b4d3` (includes the current `main` branch and its Vercel Analytics change).
- Local checks: lint and TypeScript passed; 79/79 Vitest tests passed; production Next build passed; 379/379 database assertions passed in a disposable local database; 28/28 Playwright tests passed after merging `main`.
- Public site `https://examination-platform-pearl.vercel.app/` responded HTTP 200 on November 13, 2026. No authenticated production smoke test was run.

## Remote read-only findings

- Linked Supabase target: `Examination-Platform`, production, `eu-central-1`, Postgres 17, reported healthy by the CLI.
- `supabase migration list --remote` shows the first 10 migrations applied and **13 pending**, from `202611010001` through `202611100001`. The production schema therefore does not yet support the candidate application.
- `supabase backups list` reports an empty physical-backup list and `pitr_enabled: false`. The CLI result does not rule out an independently stored logical backup, but none was verified here.
- The workspace has no `.vercel/project.json` link. The public URL does not grant access to Vercel deployment history, production environment variables, or rollback controls.

## Release decision

**No-go until recovery is verified.** No production migration, deployment, backup restore, seed, factory cleanup, or load test was executed. The 13 pending migrations include assignment, integrity, access, and dashboard changes; an older Vercel deployment cannot be assumed compatible with the migrated schema. A Vercel rollback alone would leave database migrations in place.

Before applying migrations, verify a recoverable production backup and a suitable restore destination, identify the current live Vercel deployment and its environment configuration, then review the migration plan. Use the [deployment checklist](../DEPLOYMENT.md) for the release order and smoke tests. After those items are concrete and reviewable, obtain final approval for the production mutation.
