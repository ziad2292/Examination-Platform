# Staging exam load test — 27 November 2026

## Scope

Targeted the `staging` Vercel Preview deployment and Supabase project
`ranrlqfsihteuwxhisek`. No production requests or records were used. The test
created one disposable teacher, 100 disposable students, one published exam,
one ten-question module, and assignments for every student. All generated exam
and user records were deleted after each completed run.

Each student signed in with a separate account. Sign-ins were spaced 2.7 seconds
apart because Supabase Auth limits requests by source IP and the generator ran on
one computer. After all 100 sessions were ready, the test sent concurrent page
requests through Vercel, started attempts, entered the module, saved ten answers
per student at eight-second intervals, and submitted the module. Section entry
was tested both with a direct Supabase RPC and with the real Vercel Server Action
POST used by the form.

The HTTP client downloaded server-rendered pages and submitted the section form.
It did not execute a full browser UI, Desmos, images, integrity heartbeats, or
teacher live monitoring. Answer saves and section submission called the same
database RPCs as the application, directly through Supabase rather than through
the browser Server Actions. Network traffic came from one test machine.

A subsequent hybrid run added five real headless Edge browser journeys alongside
95 HTTP traffic sessions. The browser students entered the module and selected
answers through the actual UI; the HTTP students followed the existing traffic
script. All 100 sessions still originated from this one machine. This is not a
100-browser, distributed, full-duration class rehearsal.

## Results

All 100 students signed in successfully in both full runs. Each run completed
all 100 attempts, module starts, page requests, 1,000 answer saves, and 100
submissions with zero reported failures or 30-second client timeouts.

| Phase | First run p95 | Server Action run p95 |
| --- | ---: | ---: |
| Sign in (paced) | 329 ms | 312 ms |
| Student home page, 100 concurrent GETs | 4.4 s | 6.4 s |
| Start exam, direct RPC | 812 ms | 896 ms |
| Attempt progress page, 100 concurrent GETs | 6.3 s | 18.0 s |
| Start section, 100 concurrent | 11.3 s direct RPC | 18.2 s Vercel POST |
| Section page, 100 concurrent GETs | 13.9 s | 15.0 s |
| Answer saves, 100 per wave | 0.7–1.6 s | 0.6–3.5 s |
| Submit section, direct RPC | 538 ms | 912 ms |

Vercel's function-invocation logs for the test showed zero HTTP 5xx responses.
Across the available log window, the p95 function durations were about 16.5 s
for the attempt progress GET, 13.6 s for the section GET, and 9.6 s for the
section-start POST. Their p95 CPU times were below 0.8 s. This shows the
functions spent most of their elapsed time waiting, though the logs do not by
themselves identify which upstream operation or queue caused the wait. Client
elapsed times can exceed function durations because they include edge, transfer,
and client-side waiting.

## Interpretation and limits

The previous five-minute production timeout was **not reproduced** on this
staging fixture. The test did demonstrate material latency at 100 concurrent
student page requests and section starts. The two runs varied considerably,
so one successful run is not a guarantee of stable capacity.

The code has multiple sequential Supabase calls on these routes. `src/proxy.ts`
calls `auth.getUser()` for every request. The attempt layout calls `requireRole`,
which calls `auth.getUser()` again and reads the profile, and may fetch integrity
policy. The attempt and section pages then make their own Supabase queries. This
request fan-out is a plausible contributor to waiting under concurrent load;
the test does not prove it is the sole bottleneck. The staging database region
is different from the Vercel function region, adding network round trips.

The earlier production logs also showed a separate grading failure for blank
answers (`answer_results.is_correct` rejecting NULL). This fixture answered all
ten questions, so that defect was not exercised or fixed by this load test.

## Hybrid run: 5 browsers and 95 HTTP sessions

The hybrid run **failed** the 100-student acceptance target. All 100 accounts
signed in and started an exam. At the attempt-progress page, 41 of 100 requests
failed against a 30-second client limit. Subsequent section starts had 81
failures, including downstream failures from pages that never returned the form.
Only 19 students reached the section and completed ten answers and a submission.
The test generated 122 reported phase failures in total; this is not 122 unique
students or 122 independent root failures. The disposable exam and all 101 test
accounts were deleted successfully.

| Phase | Requests | Failed | p95 elapsed |
| --- | ---: | ---: | ---: |
| Sign in, paced | 100 | 0 | 296 ms |
| Student home page | 100 | 0 | 5.2 s |
| Start exam RPC | 100 | 0 | 1.1 s |
| Attempt progress page | 100 | 41 | 30.0 s client limit |
| Start section | 100 | 81 | 30.0 s client limit |
| Section page (students who entered) | 19 | 0 | 22.5 s |

Staging Vercel function logs during this run showed the attempt-progress route
at **52 seconds p95 wall time** with only **0.8 seconds p95 CPU time**. The
section POST route showed about 14.6 seconds p95 wall time. Vercel logged no
HTTP 5xx responses for the measured load-test functions, but a client timeout
can happen while a function continues waiting. Supabase PostgREST logs in the
same window contained four `PGRST003` pool-acquisition timeouts and one SQL
statement timeout (`57014`). `PGRST003` is a concrete sign that the PostgREST
database connection pool became unavailable for some requests. It does not,
alone, identify whether query duration, request fan-out, or compute pressure
filled the pool.

**Decision:** This staging configuration did not reliably serve 100 concurrent
students in the hybrid test. Do not use the earlier successful HTTP-only runs
as a production capacity approval. Investigate the repeated Auth/profile/API
calls on exam routes, inspect database CPU and connection charts during a fresh
run, and optimize or raise capacity based on those measurements. Repeat the
hybrid test until all 100 students complete with acceptable response times.

To distinguish Vercel queueing from Supabase saturation during a recurrence,
capture Vercel function invocation durations and CPU, Supabase database CPU,
connections, pool waits, slow queries and Auth errors over the same minute. The
current test establishes a baseline, not an exact retrospective cause for the
production incident.

## Repeating safely

`scripts/load/real-exam-staging.mjs` is hard-coded to the staging project and
Preview URL. Provide the staging service-role key, staging anon key, and a
temporary Vercel automation bypass token as environment variables. Set
`LOAD_USE_SECTION_ACTION=1` to exercise the Vercel section form. The script
also accepts `LOAD_BROWSER_STUDENTS=5` to run five Edge browser journeys with
the remaining students as HTTP sessions. The generator machine must have Edge
installed. The script
automatically removes its disposable exam and accounts. If interrupted, run
`scripts/load/cleanup-staging-run.mjs <runId>` with the staging service-role key.
Check the cleanup output before another run. Never replace the hard-coded target
with production.
