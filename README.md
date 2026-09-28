# Summit SAT

A production-oriented MVP for creating and taking secure, timed SAT-style mock exams. It uses Next.js 16, React 19, TypeScript, Tailwind CSS 4, and Supabase (PostgreSQL, Auth, Storage, and RLS).

## What is implemented

- Teacher and student authentication/route guards
- Exam scheduling, draft/publish/close/archive states
- Ordered timed modules and breaks
- Four-option questions with optional Supabase Storage images
- Atomic, idempotent bulk question import from PNG/JPEG/WebP photos with in-browser answer assignment
- Question and section reordering; question deletion before attempts exist
- Server-authoritative attempts, section clocks, progression, and module locking
- Optimistic autosave with browser retry state during temporary network failure
- Refresh-safe modules and breaks
- Database-side grading with answer keys isolated in a teacher-only table
- Teacher result list and per-question review, including unanswered items
- Teacher exam administration with validation, archive/restore, safe deletion, duplication, rescheduling, and 15-second live monitoring
- History-preserving attempt resets/retakes, manual submission, audited answer-key correction, and deterministic regrading
- Reproducible migration, seed users/demo exam, pgTAP policy smoke tests, unit tests, and a k6 harness

## Local development

Prerequisites: Node.js 22+, Docker Desktop, and the Supabase CLI.

```bash
npm install
npx supabase start
npx supabase db reset
```

Copy `.env.example` to `.env.local`, then copy the local API URL and anon key printed by `supabase status`. Start the app:

```bash
npm run dev
```

Open `http://localhost:3000`. Seed password for all accounts is `LocalDemo123!`:

- `teacher@example.com`
- `student1@example.com` through `student5@example.com`

Useful checks:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npx supabase test db
```

## Environment variables

| Variable | Scope | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Browser/server | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser/server | Public anon key; RLS remains mandatory |
| `SUPABASE_SERVICE_ROLE_KEY` | Server/seed only | Optional administrative scripts; never expose publicly |
| `NEXT_PUBLIC_APP_URL` | Server | Canonical app URL |
| `APP_TIMEZONE` | Server | Display/configuration timezone; stored timestamps remain UTC |

No secret is required to compile the application. Protected pages require Supabase configuration at runtime.

## Architecture

The Next.js App Router provides server-rendered dashboards and Server Actions. Browser code receives only public question fields. PostgreSQL RPCs lock and validate state transitions. RLS independently restricts direct Supabase access. `question_keys` is separate from `questions`, so a student-readable question query cannot accidentally include correct answers.

The authoritative flow is:

`published exam → exam_attempt → ordered section_attempt → autosaved answers → submit/expire → database grading`

See [engineering report](docs/ENGINEERING_REPORT.md), [exam administration](docs/EXAM_ADMINISTRATION.md), [bulk question import architecture](docs/BULK_QUESTION_IMPORT.md), [edge-case decisions](docs/EDGE_CASES.md), and [deployment checklist](docs/DEPLOYMENT.md).

## Load test

The k6 script expects 70 pre-created student credentials and a published exam. It exercises login, attempt creation, section start, question reads, answer writes, and submission.

```bash
k6 run -e SUPABASE_URL=https://project.supabase.co \
  -e SUPABASE_ANON_KEY=... -e EXAM_ID=... load/k6-exam.js
```

Use a disposable staging project. Never run load tests against a live class.

## Known MVP limits

- Retakes require an explicit teacher grant and create a new attempt generation; self-service retakes are not supported.
- Existing attempts may finish after the global exam close time; only new attempts are blocked.
- Published content becomes immutable after the first attempt rather than using version snapshots.
- Duplicate tabs converge through database upserts and revision checks; the UI does not yet elect a single active tab.
- Live `not started` counts use all student profiles until exam-specific rosters are introduced.
- CSV export, immediate student scores, adaptive modules, estimated SAT scores, and analytics are intentionally deferred.
- Integration, RLS, and load tests require a running Supabase instance; unit/build checks run without credentials.
