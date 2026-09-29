-- PostgreSQL requires a newly added enum value to commit before later statements use it.
alter type public.app_role add value if not exists 'superadmin';
