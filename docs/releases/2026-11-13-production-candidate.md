# Assessly production release candidate — November 13, 2026

## Candidate and local verification

- Branch: `codex/feature-production-superadmin-bootstrap`
- Candidate commit: `2d0b4d3` (includes the current `main` branch and its Vercel Analytics change).
- Local checks: lint and TypeScript passed; 79/79 Vitest tests passed; production Next build passed; 379/379 database assertions passed in a disposable local database; 28/28 Playwright tests passed after merging `main`.
- Public site `https://examination-platform-pearl.vercel.app/` responded HTTP 200 on November 13, 2026. No authenticated production smoke test was run.

## Remote read-only findings

- Linked Supabase target: `Examination-Platform`, production, `eu-central-1`, Postgres 17, reported healthy by the CLI.
- `supabase migration list --remote` shows the first 10 migrations applied and **13 pending**, from `202611010001` through `202611100001`. The production schema therefore does not yet support the candidate application.
- `supabase backups list` reports an empty physical-backup list and `pitr_enabled: false`.
- Vercel CLI is linked to the existing `zaab2/examination-platform` project. Its current production deployment was Ready when inspected, and the public URL matched. Production variable names exist for Supabase URL, anon key, service-role key, app URL, and timezone; Vercel hides their values. No Desmos key or integrity flag was listed.

## Recovery artifacts

- Encrypted database archive: `C:\Users\Ziad\Assessly-Backups\assessly-sabhxtwffxwwkzvmqdks-20261113T182115Z.assessly.enc`; SHA-256 `EED5AB4252C14FC49A4DA03EB3970D74C9A0A32B8BAFF9D2EB8B0904DDA600BF`.
- Encrypted question-image archive: `C:\Users\Ziad\Assessly-Backups\assessly-storage-sabhxtwffxwwkzvmqdks-20261113T181602Z.assessly.enc`; SHA-256 `B29E98529235E2F7ABFB323357C4D87B5F5A08FCAAC94DFFAAB8DFB7C744636C`.
- The separate 32-byte recovery key is in `C:\Users\Ziad\Assessly-Recovery-Keys`. The owner confirmed copying both encrypted archives off-site and storing the key separately. Key contents are never written to this record.
- A disposable, network-isolated PostgreSQL restore completed successfully using the latest database archive: 125 profiles, 10 exams, 171 attempts, 125 Auth users, 572 Storage metadata rows, and 10 migration records. The 572 image objects were independently listed, downloaded, hashed, and encrypted. This is a local recovery drill, not a hosted Supabase restore or a proof of one-time consistency while production writes continued.
- `scripts/release/` contains guarded export and restore-drill scripts. None applies migrations or deletes production records.

## Configuration and release gates

- The owner selected integrity monitoring for opted-in exams. Set `NEXT_PUBLIC_INTEGRITY_ENABLED=true` in **Vercel Production** before the release build. A CLI attempt failed with DNS/network error; the setting was **not** saved by that attempt.
- The owner wants embedded Desmos configured before release but has no authorized key yet. Obtain a key and confirm entitlement at https://www.desmos.com/my-api, then set `NEXT_PUBLIC_DESMOS_API_KEY` in Vercel Production before building. Do not use a demo key.
- Production values of `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_APP_URL` remain unverified because Vercel hides them. An automated request to pull production variables was rejected by auto-review because it would download secret values, including the service-role key. No workaround was attempted. Verify those two public values manually in Vercel without disclosing keys.
- A `supabase db push --remote --dry-run --skip-vault` attempt did not complete due to the current network problem. The read-only migration list still establishes 13 pending migrations; inspect the final dry run before applying any.

## Release decision

**No-go pending configuration and final release review.** No production migration, deployment, backup restore, seed, factory cleanup, or load test was executed. The 13 pending migrations include assignment, integrity, access, and dashboard changes; an older Vercel deployment cannot be assumed compatible with the migrated schema. A Vercel rollback alone would leave database migrations in place.

Before applying migrations, obtain the Desmos key, set and verify the two new Vercel variables, manually check the two public URL values, and complete a migration dry run. Use the [deployment checklist](../DEPLOYMENT.md) for the release order and smoke tests. After those items are concrete and reviewable, obtain final approval for the production mutation.
