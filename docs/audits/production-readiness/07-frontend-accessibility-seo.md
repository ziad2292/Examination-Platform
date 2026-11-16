# Frontend, accessibility and SEO review

## Rendering and performance

Server-rendered role pages keep most data retrieval on the server; interactive builders, dialogs, exam runner, integrity and calculator are client components. Desmos is loaded on demand and kept in the exam tab. No new data cache or global state layer was introduced. The admin query-scope fix removes irrelevant fetches per workspace without changing its UI or permissions. The student dashboard still has request fan-out proportional to assigned exams.

The baseline's 10 sampled pages had no page errors or horizontal overflow at 1366 px. Existing E2E verifies 390/768/1366/1920 px for login and module builder. This does not cover every dialog and large roster combination. Timers initialize from Date.now on server/client and can cross a second boundary during hydration; reproducible clock-boundary browser coverage is still needed. Root body suppressHydrationWarning is not proof of hydration correctness.

## Accessibility

The shared stylesheet has visible focus styles and reduced-motion support. Password toggles have labels and type=button. Confirmation dialogs implement a focus trap and restore focus. Mobile navigation, all modal escape paths, background inertness, selected-state announcement and screen-reader timer verbosity need manual assistive-technology verification. Exam timer aria-live may announce every second. No timer semantics were changed.

`scripts/audit/accessibility.mjs` scans 10 public/role routes at 390×844 with axe WCAG A/AA checks and saves individual nodes in `evidence/accessibility.json`. Results and remediation status are summarized in the verification report. Automated checks do not establish WCAG compliance; contrast, reading order, mobile calculator editing and real keyboard/screen-reader workflows require manual review.

Final scan reports zero automated violations on all ten rendered pages. The original 37 contrast findings included a streamed loading fallback on the teacher route. The scanner now waits for a visible h1 before scanning actual page content. That revealed malformed teacher summary definition lists, corrected by placing each dt/dd pair directly inside its own dl. The loading fallback's contrast was also corrected. Original and final scans therefore differ in readiness discipline; the report does not claim they provide exhaustive coverage of identical page states.

## Public discovery and private pages

The root metadata defines title template, description, branding icons and Open Graph text. Landing content is server-rendered with semantic headings and links. There is no sitemap, canonical metadataBase, social preview image, robots file, privacy policy or terms route in the inspected application. The real production origin and approved legal content must come from the owner. No marketing positioning or legal text was invented.

Student, teacher and admin layouts now specify noindex/nofollow. Authentication/RLS remain the protection for private data. Robots directives are crawler hints, never access controls. Public landing indexing is unchanged. Registration status also merits an explicit private-page directive when the public-route metadata is organized.

## Privacy and user communication

Integrity notices distinguish observations from proof. No clipboard contents, camera/audio capture or browsing destinations are in the observation schema. Retention applies to raw events/session history; review decisions and aggregates persist. A privacy review should cover educational records, school contracts, age/jurisdiction, provider agreements, support access, export/deletion policies and incident communications. These are operational review topics, not assertions of legal requirements or compliance.
