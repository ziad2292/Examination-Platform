# Pre-fix defect reproductions

Executed against the unchanged baseline before applying the corresponding remediation.

* AUTH-01 `npx vitest run src/app/actions/auth.test.ts` had 2 failures and 3 passes. Expected `redirect:/dashboard`, received `redirect:/\\outside.example` and `redirect:/<tab>/outside.example`. Absolute and protocol-relative forms were already rejected; valid internal destinations already passed.
* SAVE-01 `playwright test e2e/student-expansion.spec.ts --grep "blocked storage"` failed at the Saved assertion after choosing an answer. Storage.getItem was patched to throw SecurityError only for the pending-answer key. The normal randomized lifecycle passed in the 22-test baseline. Fixture cleanup ran in finally.
* Initial mocked-module test run under the Windows sandbox encountered temporary-file ENOENT for three suites. A normal-permission run after dependency updates passed 78 assertions. This was a test-runner/environment failure, not an application assertion failure.
* npm 10.9.2 crashed in Arborist edgesOut while resolving the test dependencies. npm 11 completed the update. It did not change global npm. Windows also reported an old loaded SWC binary could not be removed; the new installed framework version was subsequently used for verification.
