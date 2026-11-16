# Architecture and system review

## Implemented system

Assessly is one Next.js App Router application, TypeScript and React, with Tailwind CSS and Lucide icons. There is no separate Node backend to start. Server Components fetch scoped data through the cookie-based Supabase client. Server Actions perform form and exam mutations. Three JSON Route Handlers serve integrity registration, synchronization and exit. PostgreSQL RPCs implement transactions and the examination state machine. Supabase supplies Auth, PostgREST, private Storage and Realtime.

Routes are grouped into public landing/login/registration, student exam/profile, teacher builder/results/monitor, and Super Admin workspaces. `WorkspaceShell` maintains the shared navigation and red theme. Client state is local React state/refs, browser pending-answer storage and an independent integrity queue. There is no global state library. Production build marks most routes dynamic, registration and framework assets static. `getViewer` uses request-scoped React cache; no cross-user private result cache was found in inspected code.

`src/proxy.ts` refreshes cookies and calls Auth getUser. Protected layouts and mutation actions check active role through `requireRole`; PostgreSQL policies and functions remain the decisive direct-API authorization layer. The server-only admin client is isolated in `lib/supabase/admin.ts`. Public anon keys are expected browser configuration, service-role credentials are not. Local service-role configuration is a placeholder in the normal app environment; audit preview receives the local key only through process environment.

## Examination path

Teacher draft creation uses idempotent `create_exam_draft`, then section/question configuration, explicit student links, and publish/scheduling RPCs. Draft editing and post-attempt protections live in database functions/triggers. Question import stages private images, checks MIME/signature, commits a batch, and tracks cleanup. Duplication copies exam configuration, never attempt evidence.

`start_exam` checks active student, current relationship/assignment, publication, schedule and optional code; it resumes an in-progress generation or consumes a retake grant. Existing history survives assignment changes. Starting a section persists expiry and checks module sequence. Answers map by stable question UUID, not displayed position. Question randomization snapshots a sequence per attempt. `save_answer` locks attempt then section and checks section membership, deadline and revision. Equal revisions retain the existing last-write behavior. Multiple browser sessions remain allowed.

Section submission finalizes grading through database functions. Raw correct-answer counts and question totals are the implemented scoring basis; percentage display helpers do not constitute SAT scaled scoring. No partial-credit or official scaling engine was found. Published marks are masked through student summary/history RPCs and RLS. Answer keys, review notes and marks have distinct access paths. This audit changes no scoring or timing rule.

Integrity is optional at both build-release and exam levels. Attempts snapshot settings. Browser signals are untrusted observations validated, deduplicated and counted server-side. Breaks suspend attention counting; connectivity remains informational. Admin policy is editable; fullscreen monitoring was deliberately removed in prior work. Desmos is an embedded per-module panel with an external entitlement/key requirement. Realtime publishes summary rows only and polling provides recovery.

## Structural strengths and debt

Database transactions, explicit keys/constraints, consistent lock ordering and pgTAP coverage are strong foundations. The main maintenance problem is accumulated function replacement across migrations and dense one-line application modules. Read the latest function definition, not only the initial schema. Tests provide more reliable contracts than old feature documents.

Component-level data access is pragmatic at this size, but several pages mix fetching, formatting and large forms. Extract by demonstrated reuse or test need; a rewrite is unwarranted. Large admin imports and Auth compensation span services and need durable recovery design. Monitoring shares attempt locks with answers, so heartbeat/event traffic needs staging contention measurement. Student-dashboard N+1 and unbounded history/monitor queries need representative-scale profiling before optimization.

## Implemented versus operationally unverified

Implemented includes registration approval, many-to-many teachers, explicit exam assignments, randomization, hidden results, bulk administration, timers, autosave, integrity events, review and local retention cron. Production alerting, verified restore procedures, hundreds-of-user capacity, production Desmos entitlement, full browser/assistive-technology certification and automatically deployed migrations are not established by repository code.
