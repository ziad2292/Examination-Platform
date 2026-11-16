# Performance benchmark report

## Reproducible local observations

Method, hardware and dataset limits are in [the baseline report](03-baseline.md). Raw files `before-browser.json` and `final-browser.json` use the same script, routes, viewport, seed accounts, 20 sequential requests per route and local production preview. Final samples ran without a competing browser regression workload. Initial and final runs occurred on different dates and a shared desktop host, so cache/host activity and framework updates confound attribution. No percentage throughput gain or capacity claim is justified.

Milliseconds for full authenticated document request plus body consumption, not individual answer-saving RPCs.

| Route | Before p50 / p95 / p99 | After p50 / p95 / p99 |
|---|---|---|
| Home | 25.16 / 37.59 / 42.18 | 6.96 / 8.38 / 19.06 |
| Login | 13.25 / 17.66 / 19.20 | 5.12 / 6.85 / 9.26 |
| Teacher | 68.25 / 95.55 / 112.83 | 49.12 / 80.43 / 104.75 |
| Teacher monitor | 68.52 / 85.90 / 101.06 | 54.94 / 106.43 / 137.64 |
| Student | 38.06 / 48.59 / 54.37 | 15.79 / 41.35 / 67.83 |
| Student profile | 34.59 / 43.54 / 44.20 | 17.29 / 24.27 / 47.96 |
| Admin overview | 52.62 / 67.76 / 77.03 | 32.56 / 63.88 / 66.00 |
| Admin create | 50.20 / 54.62 / 58.03 | 21.12 / 50.55 / 53.99 |
| Admin accounts | 53.65 / 69.50 / 82.20 | 31.44 / 44.75 / 46.96 |
| Admin students | 46.69 / 52.97 / 53.53 | 31.10 / 39.17 / 55.58 |

All 200 baseline and 200 final requests returned 200, with no captured JavaScript page errors. Monitor p95/p99 regressed, as did student, profile and admin-students p99, despite lower medians. Twenty samples are insufficient to distinguish noise from a tail regression. Do not hide those results by reporting only medians. The earlier post-fix run (`after-browser.json`) and exact final run demonstrate substantial host/run variability.

## Browser and asset measurements

Sampled CLS stayed 0. Final lab LCP ranged 44–380 ms; baseline 68–576 ms. The measurements observe only a short window, are unthrottled, and are not representative of real-user Core Web Vitals. TTFB, load times and individual script sizes are available per route in JSON. INP and real-device/slow-network results were not measured.

Total static assets were 1,550,214 bytes before and 1,550,426 in the final build. The 212-byte increase is immaterial. Per-route script payloads increased by roughly 2 KB after the framework security update, for example login 140,853 to 142,931 bytes. Security remediation was not described as a bundle-size optimization.

## Verified efficiency change

Admin workspace data queries previously executed five requests in every area. They now execute zero for create/import, two for accounts/students, one for data management and three for overview. Authentication and layout approval-count queries remain and are excluded from those figures. Tests assert the consumed queries are preserved. This deterministic request reduction is stronger evidence than noisy small-dataset latency differences.

## Database and operational measurements

Representative authorized query execution was 1.144 ms for the exam list and 0.421 ms for the latest summary on four exams. No SQL/index/cache optimization was made, so no database speedup is claimed. Resource/connection snapshots are recorded in the baseline; sustained CPU, memory growth, connection saturation and lock waits were not profiled under load.

## Required staging workload

Create dedicated disposable data at representative exam/question sizes, 50/100/200 distinct students and concurrent teacher monitors. Measure starts, timed save traffic, reconnect replay and submissions separately, then together. Include wrong-role access, errors, retry storms, timed expiry and answer correctness in the workload assertions. Record p50/p95/p99, throughput/error counts, database locks/connections, CPU/RAM, save success, grading duration and Realtime reconnect recovery. Compare identical runs before any future SQL/caching change. Do not run cleanup or load scripts against production.

Existing k6 files are workload starting points, not evidence of a completed test in this audit. No fresh load, soak or stress test was run, and 500-student integrity claims from older work are not reused as whole-platform capacity evidence.

**November 10 update.** The preceding paragraph describes the original audit run. A later isolated database workload now covers 50/100/200 distinct students, 8,050 successful transactions and persisted-answer/grading checks. [The supplement](10-local-release-gates.md) reports the measured latency degradation and exact limitations. Full HTTP/Realtime and soak capacity remain unverified.
