# Assessly exam integrity engine

The engine is optional, disabled by default, and independent of grades, answer saving, and server-authoritative section expiry. Browser observations are review indicators, not proof of cheating. Multiple sessions are allowed. No incident submits, pauses, or disqualifies an attempt.

## Implementation map

- Database: migrations `202611060002` through `202611060007` add settings, attempt snapshots, browser sessions, immutable events, append-only reviews, RLS, ingestion/review RPCs, duplication integration, audit events, retention, and fixed policy constants. Migration `007` removes fullscreen enforcement and exception operations without deleting historical evidence.
- Transport contracts: `src/lib/integrity.ts`, `integrity-handler.ts`, and `use-exam-integrity.ts`.
- HTTP: authenticated POST `/api/integrity/session`, `/sync`, and `/exit`. Same-origin JSON requests only, 32 KB body limit, at most 50 strictly validated observations. Exit accepts lifecycle observations only. Cookie authentication and the database determine ownership; clients cannot supply classifications or totals.
- Database API: `configure_exam_integrity`, `review_exam_integrity`, `integrity_sync`, `student_integrity_preview`, and `student_attempt_integrity_policy`. Private helpers snapshot and recompute summaries. Retention is not granted to ordinary application users.
- Student UI: persistent attempt layout/provider, detector and transport hooks, warning status, and embedded calculator. Modules begin normally without a fullscreen prompt or telemetry preflight gate. Break/progress screens suspend attention and clipboard counting. Submission suspends detectors before the normal transition.
- Teacher UI: exam Settings contains enablement, clipboard restrictions, and warning/logging-only options. No threshold, cooldown, fullscreen, accommodation, or change-reason fields remain. Monitor contains authorized live summaries; attempt details contain a paginated timeline, dismiss/reinstate, and private notes.
- Super Admin: `/admin/integrity` provides accessible Policy constants and Monitoring & review tabs. Constants are read-only and retrieved through the administrator-only `admin_integrity_policy` RPC.

## Rules and recovery

Settings are snapshotted when an attempt is created. Changes affect future attempts, including retakes. Existing attempts are initialized disabled. Duplicating an exam copies configuration only. Review actions and raw evidence are never copied.

Attention requires two seconds of absence. Overlapping focus/visibility observations share an attention episode. The database applies a fixed ten-second category cooldown. A new attention episode requires a return. Clipboard interception never reads clipboard contents. Calculator editing is exempt, and runner numeric shortcuts ignore editable/calculator targets.

At the fixed threshold of three counted incidents, the summary is flagged for teacher review. Teachers cannot override the threshold or cooldown through the UI or API; new attempt snapshots use database constants. Existing threshold snapshots and counts remain preserved. Saving monitoring settings needs no change reason; settings changes are still audited automatically. Dismissal preserves the observation and changes the effective aggregate; reinstatement can create a new review cycle. Review explanations and private notes remain teacher-only. Connectivity, reloads, exits, and observations received more than thirty seconds late do not increase counts. Logging-only policy records evidence without counting.

Heartbeats run every twenty seconds. Contact older than sixty seconds is labeled connection unknown. Queue uploads run every five seconds with immediate suspicious-event attempts, exponential backoff and jitter, a 200-event session-storage bound, and acknowledgement-based removal. Queued observations retain their original document identity across refresh; old-page exits never close the refreshed document. Storage/telemetry failures never block assessment actions. Reload retires the previous document for the same browser instance. A BroadcastChannel probe detects cloned tab identities where supported. Browser exits/beacons and browser-instance identity are best effort, not tamper-proof identity or single-writer locking.

Fullscreen is neither required nor monitored. No fullscreen browser listeners, entry controls, or exception forms remain. Stale clients' fullscreen observations are acknowledged without logging/counting them or opening attention episodes. Historical fullscreen evidence and exception audit records remain intact. The private ingestion function is not executable by application users.

## Database and security

All new relationships use exam/attempt deletion cascades. Unique event UUIDs and per-document sequences prevent replay counting. Ingestion serializes on the attempt and summary in one transaction. Direct student writes and reads of raw monitoring tables are denied; students receive sanitized policy and summary RPC responses only. Active-account checks, attempt ownership, section association, and teacher exam ownership run inside fixed-search-path security-definer functions. Super Admin access is explicit in policies and management RPCs.

Only `attempt_integrity_state` is added to `supabase_realtime`. No raw events, notes, browser payloads, or answers are published. The teacher subscription filters by exam, is protected by SELECT RLS, and refetches on subscription/reconnection; existing fifteen-second polling remains the fallback. See [Supabase Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes).

Daily retention removes only raw events and browser sessions for attempts completed more than ninety days ago. It first preserves effective aggregates; review decisions, answers, and grades remain. Where `pg_cron` is available, the migration schedules the narrowly scoped job. Otherwise configure an equivalent privileged daily call to `public.retain_integrity_history()`; never expose this function to students/teachers. Verify the job exists and runs in the deployed environment.

## Desmos

`EmbeddedCalculatorPanel` uses the [official pinned v1.12 API](https://www.desmos.com/api/v1.12/docs/index.html?lang=en). Set `NEXT_PUBLIC_DESMOS_API_KEY` to the owner's authorized key and confirm entitlement before release. No demo key is supplied. The key is a public browser configuration value, not a server secret. Network/script failure offers a retry; no external tab is opened. State is stored per section attempt in session storage, preserved while collapsed and on refresh, and isolated between modules. Respect existing server-provided `allow_calculator`.

The licensed SDK and live expression persistence still require verification with the owner's real key. Automated local tests cover the missing-key state rather than pretending the third-party SDK loaded.

## Deployment and rollout

1. Back up the database through the existing operational procedure. Review migrations against staging first. Apply the complete ordered migration chain using the existing Supabase migration process (`supabase db push` against the intended linked environment). An application-only deployment does not run database migrations unless its pipeline explicitly does so. Never run database reset/seed or disposable load fixtures on a deployed database.
2. Keep `NEXT_PUBLIC_INTEGRITY_ENABLED=false` initially. Build-time public flags require rebuilding the app when changed. Database settings are also disabled by default.
3. Verify RLS, audit writes, Realtime publication, and the retention job on staging. Set the licensed calculator key and verify supported desktop/mobile devices.
4. Build staging with the release flag true, enable monitoring for a disposable exam with enforcement unchecked, then review evidence and false positives. Existing attempt snapshots do not change.
5. Complete cross-browser, recovery, API/Realtime load, and simultaneous answer-save testing before enabling counted incidents for real exams. Use small cohorts before increasing scale.
6. Emergency operational disable: rebuild with the release flag false. Disabling an exam policy affects future attempts only; the global release flag stops browser ingestion. Keep durable evidence for authorized review.

## Reproducible verification

Run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`. Run `npx supabase test db` only against an isolated local/test database. Playwright defaults to the installed Edge executable; override `E2E_BROWSER_PATH` as needed. Set `E2E_BROWSER=firefox` or `webkit` after installing those Playwright engines. Each browser uses its own artifact directory. Run browser suites serially against the local fixtures.

For enabled browser tests, build/start an isolated app with `NEXT_PUBLIC_INTEGRITY_ENABLED=true` and `NEXT_DIST_DIR=.next-integrity`, then run Playwright with `E2E_INTEGRITY=true` and `E2E_BASE_URL=http://localhost:3002`. These tests reject non-local Supabase URLs and remove only their disposable exam records.

`load/integrity-fixture.sql`, `load/k6-integrity.js`, and `load/integrity-cleanup.sql` form a **local-only** 500-student / 5-teacher RPC/polling load test. The script rejects remote URLs and needs local-only JWT credentials. Cleanup targets an exact fixture exam and explicit synthetic account namespace. It does not benchmark Next cookie-auth routes, answer saves, or Realtime fan-out.

### Local verification findings

- 61 unit tests passed, including fake-clock attention qualification/correlation and document-preserving replay; lint and TypeScript passed.
- 314 database checks passed on an independently seeded disposable database, covering isolation, replay, concurrent atomic threshold crossing, correlated episodes, dismissal history, independent retakes, logging-only behavior, sanitized responses, aggregate-preserving retention, fixed constants, administrator access, optional change reasons, and removed fullscreen ingestion. The shared local application's manually started attempts were preserved.
- Browser regressions cover telemetry failure without affecting answer saving, refresh/answer recovery, session overlap, calculator missing-key fallback and numeric-key isolation, modules starting without fullscreen, teacher dismissal/private notes, disabled monitoring discoverability, simplified settings, and admin policy tabs. See the current implementation report for the latest executed browser totals; earlier fullscreen-preflight tests have been replaced.
- Integrity-enabled optimized production build passed. The default output build encountered a Windows file permission conflict while an existing server was running; verification used the separate output folder.
- Corrected local load run: 500 students and five polling teachers, 2,025 requests, zero failures, p95 19.03 ms; all configured thresholds passed. The previous run's 24 failures came from a harness identity bug (global VU IDs included teacher VUs); an earlier simultaneous-start run hit local connection-refused errors. This short RPC/polling benchmark does not establish production capacity. All 500 synthetic students and their disposable exam/attempts were removed after the run.
- Firefox was installed but could not launch on this Windows host (`browserType.launch: spawn UNKNOWN`), including after installation completed. No Firefox workflow pass is claimed. Full staging capacity, Realtime fan-out recovery under load, simultaneous answer-save latency, Firefox/real-device testing, and licensed Desmos verification remain release gates. The feature stays disabled by default.

Do not infer production readiness from local functional tests. No production database changes or production load tests were performed.
