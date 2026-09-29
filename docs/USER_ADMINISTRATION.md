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

Do not commit a production password or place it in a migration, seed file, build argument, or client-visible variable. After production migrations are applied, configure these server-only environment variables in the deployment environment:

```text
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<production-service-role-key>
BOOTSTRAP_SUPERADMIN_ENABLED=true
BOOTSTRAP_SUPERADMIN_FULL_NAME=<administrator-name>
BOOTSTRAP_SUPERADMIN_EMAIL=<administrator-email>
BOOTSTRAP_SUPERADMIN_PASSWORD=<12+-character-password>
```

The password must contain uppercase, lowercase, numeric, and symbol characters. Run the bootstrap once from a protected deployment job or administrator terminal whose environment contains those values:

```bash
npm run bootstrap:superadmin
```

The command creates a confirmed Supabase Auth user, creates the matching active `superadmin` profile, and records a password-free audit event. If the email already belongs to a Super Admin, the command is idempotent and does not reset the password. Set `BOOTSTRAP_SUPERADMIN_ROTATE_PASSWORD=true` only for a deliberate rotation. If the email belongs to a student or teacher, the command refuses promotion unless `BOOTSTRAP_SUPERADMIN_ALLOW_PROMOTION=true` is explicitly set after the account is verified.

After success, set `BOOTSTRAP_SUPERADMIN_ENABLED=false` and remove `BOOTSTRAP_SUPERADMIN_PASSWORD` from persistent deployment configuration. Keep `SUPABASE_SERVICE_ROLE_KEY` available only to server runtime features that use the Admin API. Never expose any of these values through `NEXT_PUBLIC_` variables other than the public project URL.

The manual SQL fallback remains available when deployment jobs cannot run Node. Create a normal confirmed Auth user through the Supabase Dashboard, verify its user ID and email, then promote the corresponding profile in the production SQL editor:

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
