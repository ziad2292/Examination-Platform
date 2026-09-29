# Super Admin and user administration

## Authorization model

`superadmin` is a distinct application role. The `/admin` route, every user-management Server Action, profile-list RLS, and every user-management RPC independently require an active Super Admin profile. Teachers and students are redirected to their own dashboards and receive database authorization failures if they invoke the RPCs directly.

Deactivation bans the Supabase Auth user through the server-only Admin API and marks the profile inactive. Restrictive RLS policies block an inactive access token from reading application tables, while mutation triggers reject writes through security-definer student attempt functions. Teacher ownership helpers also require an active profile.

## Local account

The development seed creates:

- Email: `admin@example.com`
- Password: `AdminLocal123!`

These credentials are for the disposable local Supabase stack only. Never run `supabase/seed.sql` against staging or production.

## Creating a production Super Admin

Do not commit a production password or automate a fixed privileged credential. Create a normal confirmed Auth user through the Supabase Dashboard or an approved identity-provider flow, then promote the corresponding profile in the production SQL editor after verifying the user ID and email:

```sql
update public.profiles
set role = 'superadmin', is_active = true,
    deactivated_at = null, deactivated_by = null
where id = '<verified-auth-user-uuid>' and email = '<verified-admin-email>';
```

Confirm the account can reach `/admin`, then create a second recovery administrator. The database prevents demoting, deactivating, or deleting the last active Super Admin.

## Managed user lifecycle

The admin UI creates teachers and students through a server-only Supabase Admin client. `SUPABASE_SERVICE_ROLE_KEY` is read only by server code. The Server Action creates the Auth account, inserts the matching profile with the service-role client, and records the audit event. If profile or audit creation fails, it removes the new Auth account so a partial user is not retained. Public Auth metadata is never trusted to provision an application profile or assign a role.

Names, emails, roles, and active status can be updated. Email and ban changes are applied to Auth first; if the protected profile RPC rejects the change, the action attempts to restore the previous Auth values. Every accepted profile mutation records before/after state, actor, reason, and operation key.

Role changes are rejected after a user owns an exam or has an attempt. Historical accounts cannot be hard-deleted. They must be deactivated so exam ownership, answers, scores, and audit attribution remain intact. A history-free account can be deleted after exact-email confirmation; the database rechecks eligibility and foreign keys prevent a concurrent history write from producing an orphan.

## Bulk user import

Super Admins can upload `.csv` or `.xlsx` files with the exact headers `full_name`, `email`, `role`, and `password`. A file is limited to 1 MB and 50 populated rows so Auth creation and rollback remain within a bounded server request. Roles are limited to `student` and `teacher`; names, emails, and passwords use the same production validation as single-user creation. Password whitespace is preserved rather than silently altered. The preview marks every invalid row, every case-insensitive duplicate within the file, and emails already present in either Supabase Auth or `profiles`. No accounts are created until every row passes.

The validated payload is encrypted, bound to the current Super Admin, and expires after 30 minutes. Immediately before execution, the server repeats all validation and the Auth duplicate scan. Passwords exist only in the uploaded file, the short-lived encrypted confirmation token, and the server-side request to Supabase Auth, which hashes them. Passwords are never written to profiles, import journals, audit events, or logs.

`user_import_batches` and `user_import_items` record the actor, time, source-file hash, sanitized row identity, and per-row outcome. If any Auth/profile row or the completion audit fails, the action removes every account created by that batch. A fully rolled-back batch is safe to retry; a rollback failure is locked for administrator review. Imported Auth users carry only recovery metadata identifying their batch and row, allowing an interrupted import to be recovered after its processing lease becomes stale.

## Exam builder behavior

Exam sections are compact accordion cards. The first section opens initially; other modules and breaks remain minimized until the teacher explicitly expands them. Summaries show type, order, duration, question count, and readiness at a glance. Existing question ordering, bulk import, manual add, image replacement, and immutability rules remain inside the expanded editor.
