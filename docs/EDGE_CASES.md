# Deterministic edge-case decisions

1. Refresh during a module reloads the same `section_attempt` and derives remaining time from `expires_at`.
2. Refresh during a break behaves identically; a break is a timed section without questions.
3. Failed answer saves retain the newest payload locally and retry on the browser `online` event.
4. Reopening the browser restores the unique in-progress attempt and active section.
5. Duplicate tabs write the same unique answer row. Revisions reject an older write from the same tab; concurrent-tab writes resolve to the last accepted database update.
6. Expiry while saving causes the database to reject the late write. Previously saved answers remain intact and the section is submitted as expired.
7. Global close blocks new attempts. A student who started earlier may finish remaining sections using their configured durations.
8. Rapid navigation is local UI state and does not create requests.
9. Rapid answer changes carry monotonic revisions. The persisted row cannot be replaced by an older revision from that tab.
10. Manual API calls face Auth, RLS, ownership, ordering, and expiry checks.
11. A changed section identifier is rejected unless it is the next section in the attempt's exam.
12. Another student's attempt ID returns no row through RLS and fails all mutation functions.
13. Once an attempt exists, content, access-code configuration, opening time, earlier closing times, and question images are immutable. Title, description, instructions, and a later closing time remain safe to change.
14. Question deletion is forbidden after an attempt exists; before then, remaining order values are compacted.
15. Starting shortly before close is allowed. The attempt may finish after close; this is the documented MVP policy.
16. Rescheduling never recalculates a running section's `expires_at`; section timers are authoritative snapshots.
17. Reset preserves the original attempt as expired and issues one retake grant. Starting again creates and links a new generation.
18. Manual section/attempt submission is idempotent and prevents future writes through the same terminal-state checks as normal submission.
19. Archive and student start serialize on the exam row. Either start wins and archive is rejected, or archive wins and start is unavailable.
20. A stale metadata, reschedule, or image-replacement form is rejected instead of overwriting a newer edit.
21. Answer-key correction is the only post-attempt content exception: it records the old/new key and reason, then recalculates terminal attempts from source answers.
22. Database deletion commits before Storage cleanup. Failed object removal stays in a cleanup queue rather than rolling back historical integrity.
23. Duplicate operations use a stable job and deterministic image paths, so retrying after a network timeout does not create another exam or image set.
