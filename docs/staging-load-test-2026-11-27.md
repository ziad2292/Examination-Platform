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
automatically removes its disposable exam and accounts. If interrupted, run
`scripts/load/cleanup-staging-run.mjs <runId>` with the staging service-role key.
Check the cleanup output before another run. Never replace the hard-coded target
with production.
