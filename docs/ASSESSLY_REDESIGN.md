# Assessly workspace redesign

## Design system

Primary brand: `#910000`; hover: `#700000`; tinted surfaces: `#fff0f0`.
Slate text, neutral application background, compact cards and shared focus states.
The text-based Assessly mark and SVG icon share the crimson brand color.
Success, warning, and error colors retain their semantic meaning.

## Navigation

- Admin: overview, students and ownership, accounts, assessment directory, create account, import, and data management.
- Teacher: assessment dashboard, assigned students, and draft creation. Each exam has Overview, Students, Settings, Structure, and Review & publish panels.
- Student: searchable assessment list with Available, In progress, Upcoming, Completed, and Closed filters. Timed attempts omit the application sidebar.

Admin routes render the appropriate server component rather than hiding unrelated sections in the browser. Existing routes and server/database role checks remain in effect.

## Builder

Creation groups information, access/results, and schedule into three retained form steps. A created draft opens the same workspace used for editing.
Builder panels preserve mounted form state; panel selection updates the URL and supports browser history. Unsaved edits trigger refresh/leave protection.
Modules and breaks have a dedicated navigator. Questions have numbered selection and previous/next controls. Section creation is available directly from Structure. Publishing and lifecycle controls live in Review & publish and use existing validation and actions.

## Interaction components

`BuilderWorkspace`, `QuestionNavigator`, `AddSectionPanel`, `StudentAssessments`, `AdminWorkspacePage`, `WorkspaceShell`, `Brand`, and `DialogFocus` provide shared patterns. Confirmation dialogs trap keyboard focus and restore it on close.
Account editing uses compact disclosure rows and paginated server queries. Student ownership supports name/email search, teacher filtering, page selection, and pagination.

## Verification commands

Start local Supabase and Next.js, then run:

```powershell
npm run check
npm run test:e2e
npx supabase test db
```

Playwright uses installed Microsoft Edge on Windows. Override `E2E_BROWSER_PATH` for another Chromium executable and `E2E_BASE_URL` for another local frontend port. Tests use the seeded local accounts and never run factory cleanup against a remote database. Screenshots are generated under `test-results/`.

No database migration or infrastructure change is required for this visual redesign. Existing backend features, grading, timing, permissions, and restrictions remain the source of truth. Admin assessment directory is read-only; teacher lifecycle and grading tools retain their existing authorization. New assessment types, scoring systems, and new editing capabilities remain separate feature work.
