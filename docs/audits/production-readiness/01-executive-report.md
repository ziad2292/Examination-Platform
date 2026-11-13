# Assessly production-readiness audit

## Decision

Assessly has useful database-enforced isolation and a substantial passing local regression suite. This audit found and fixed specific security, reliability, query-efficiency and accessibility defects. It does **not** establish readiness for hundreds or thousands of simultaneous examination users. Production launch remains gated on controlled staging capacity tests, operational recovery verification and the unresolved risks below.

November 10 follow-up completed fresh application migration replay, another 374 passing database assertions, clean lockfile installation and bounded 50/100/200-student database workloads. Correctness passed, but the capped 2-CPU environment reached 9.69-second save p99 under the largest burst. See [local release checks](10-local-release-gates.md) for methodology, limits and the new browser CI job.

The baseline was saved before remediation. Existing user workflows, grading, module/break deadlines, eligibility, RLS and submission semantics were preserved. No migration, production deployment, production-data change or destructive shared-local reset was performed.

November 10 remediation update: a new additive student-dashboard summary migration was applied to local development only. The current verification and release assessment are in [the remediation outcome](12-remediation-outcome.md); the paragraph above describes the original audit phase.

## Improvements

* Patched Next, Zod, image/source-map libraries and test tooling. The production dependency audit now reports zero advisories; eight moderate lint-tool findings remain.
* Rejected malformed external post-login redirect destinations, with failing-before/passing-after tests.
* Fixed blocked browser storage preventing immediate answer saves, verified with a real randomized exam fixture.
* Removed unused admin queries while preserving every workspace's required data and authorization.
* Added noindex/nofollow to protected role layouts.
* Darkened confirmed low-contrast secondary text without changing the red theme or layout.
* Added reproducible audit scripts, HTTP boundary tests, browser regressions and evidence files.

## Highest-priority open work

1. Run deployment-equivalent staging tests for 50/100/200 simultaneous students, mass starts/saves/submissions and Realtime recovery, including latency and lock measurements. Local page samples are insufficient.
2. Design durable reconciliation for multi-step Supabase Auth/profile administration and demonstrate failure recovery.
3. Characterize offline/pending-save submission behavior. The user explicitly deferred changing submission semantics to a separately approved task.
4. Verify fresh migration replay, hosted backup restoration, rollback procedure, cleanup job monitoring and alerts. Application deployment does not automatically apply database migrations.
5. Complete Firefox, assistive-technology, real-device and third-party Desmos entitlement/loading verification. Add browser checks to CI and address remaining development dependency advisories without forced downgrades.

## Report map

* [Architecture and system review](02-architecture.md)
* [Functional baseline](03-baseline.md)
* [Security assessment](04-security.md)
* [Performance measurements](05-performance.md)
* [Database and infrastructure](06-database-infrastructure.md)
* [Frontend, accessibility and SEO](07-frontend-accessibility-seo.md)
* [Findings and remediation roadmap](08-roadmap.md)
* [Changes and verification](09-verification.md)
* [Supplemental local release gates](10-local-release-gates.md)
* [Finding-by-finding remediation tracker](11-remediation-tracker.md)
* [Remediation outcome and release assessment](12-remediation-outcome.md)

All measurements are local and dated in evidence. Baseline started November 7 and verification continued November 9, 2026. Starting Git HEAD was `db2677d73a0ad5735b0f6bf44c4b237a1ffbefac` with extensive pre-existing uncommitted work. This report is a scoped engineering assessment, not a penetration-test or compliance certification.
