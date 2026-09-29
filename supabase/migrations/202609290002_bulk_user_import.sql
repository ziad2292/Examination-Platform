create type public.user_import_status as enum ('processing','completed','rolled_back','rollback_failed');
create type public.user_import_item_status as enum ('pending','created','failed','rolled_back','rollback_failed');

create table public.user_import_batches (
  id uuid primary key,
  created_by uuid not null references public.profiles(id),
  operation_key uuid not null,
  filename text not null check(length(filename) between 1 and 255),
  file_sha256 text not null check(file_sha256 ~ '^[a-f0-9]{64}$'),
  status public.user_import_status not null default 'processing',
  row_count integer not null check(row_count between 1 and 50),
  created_count integer not null default 0 check(created_count >= 0),
  failed_count integer not null default 0 check(failed_count >= 0),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(created_by,operation_key)
);

create table public.user_import_items (
  batch_id uuid not null references public.user_import_batches(id) on delete cascade,
  row_number integer not null check(row_number >= 2),
  full_name text not null check(length(full_name) between 2 and 120),
  email text not null check(length(email) <= 254),
  role public.app_role not null check(role in ('student','teacher')),
  status public.user_import_item_status not null default 'pending',
  user_id uuid,
  error_code text,
  error_message text,
  primary key(batch_id,row_number),
  unique(batch_id,email)
);

create index user_import_batches_actor_created_idx on public.user_import_batches(created_by,created_at desc);
alter table public.user_import_batches enable row level security;
alter table public.user_import_items enable row level security;
create policy user_import_batches_superadmin_read on public.user_import_batches for select to authenticated
  using(public.is_superadmin());
create policy user_import_items_superadmin_read on public.user_import_items for select to authenticated
  using(public.is_superadmin() and exists(select 1 from public.user_import_batches b where b.id=batch_id));
create policy user_import_batches_active_session on public.user_import_batches as restrictive for select to authenticated
  using(public.is_active_user());
create policy user_import_items_active_session on public.user_import_items as restrictive for select to authenticated
  using(public.is_active_user());

revoke all on table public.user_import_batches,public.user_import_items from public,anon;
grant select on table public.user_import_batches,public.user_import_items to authenticated;
