# Security assessment

## Confirmed and reproduced

AUTH-01 allowed malformed external return paths in the login Server Action. A regression test failed for both backslash and tab-normalized slash input before remediation. The fix rejects backslashes/control characters and external/protocol-relative forms while retaining internal queries and fragments. A browser regression verifies the landing destination after successful login. No token theft or external attack was attempted.

DEP-01 is a confirmed vulnerable dependency-version finding. Registry evidence is stored before/after. The maintainer's [Server Actions advisory](https://github.com/vercel/next.js/security/advisories/GHSA-p3m5-59mp-jv5r) applies to the application's App Router/Server Action configuration; no denial-of-service exploit was executed. The [image optimization advisory](https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw) has Linux/image-library preconditions. Other Next cache advisories require features not found enabled here. An installed affected package is not proof that every described exploit is reachable.

## Authorization evidence

Every public table has RLS enabled in the local catalog. All application security-definer functions inspected through the catalog specify search_path; two extension-owned dblink_connect_u overloads are outside that application set. Explicit database tests cover student ownership, Teacher A/B isolation, inactive users, hidden marks, question keys, code ownership, registration, admin operations and direct writes. Only `attempt_integrity_state` is in the Realtime publication. Publication membership alone does not prove unauthorized subscription behavior; staged multi-client subscription tests remain required.

Integrity JSON handlers enforce exact origin, JSON content type, a streamed 32 KiB bound, strict schema and authenticated RPC scope. New HTTP-boundary unit tests cover malformed/oversized/cross-origin requests and unauthenticated calls. Database tests cover event counting and replay. The frontend flag can disable telemetry entirely, so rollout must verify the compiled release flag as well as database settings.

## Sensitive information, uploads and abuse

Inspection found server-only service-role construction and no application use of dangerouslySetInnerHTML/eval. User text is rendered through React. Question upload/import checks include image signatures and private storage paths; SVG uploads are not part of the supported question-image path. Service-role operations require Super Admin actions, but cross-service partial failure remains an operational risk. Logs generally record error codes rather than passwords/tokens. This is source review, not a forensic secret-history certification.

Auth provider limits are the principal login/signup abuse control. A production rate-limit/configuration assessment and authorization-aware edge controls are not verified. Integrity has database limits, but direct Supabase access means Next-only controls cannot protect every RPC. No speculative process-local limiter was introduced.

## Outstanding controls

Basic security headers exist, including nosniff, frame denial, referrer policy, device-permission restrictions and production HSTS. CSP is absent. Deploying an enforcing CSP without testing Next scripts, Supabase connections and Desmos can break exams; stage report-only first. Origin checks and Server Action handling do not replace database authorization.

Cross-service Auth/profile rollback errors require durable reconciliation, not optimistic success messages. Storage cleanup and audit consistency should be failure-injection tested. Production Auth recovery/redirect allowlists, email delivery, MFA/admin account policy, hosted backups, secrets rotation, hosting access and least-privilege operators remain uninspected. No legal compliance certification or penetration-test completeness claim is made.
