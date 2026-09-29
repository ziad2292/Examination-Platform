# Deployment checklist

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
