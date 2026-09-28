alter table public.profiles
  add column is_active boolean not null default true,
  add column deactivated_at timestamptz,
  add column deactivated_by uuid references public.profiles(id),
  add constraint profiles_deactivation_consistency check (is_active = (deactivated_at is null));

create unique index profiles_email_unique_ci on public.profiles(lower(email));
create index profiles_admin_search_idx on public.profiles(role,is_active,created_at desc);

create function public.is_superadmin() returns boolean
language sql stable security definer set search_path=''
as $$
  select exists(
    select 1 from public.profiles
    where id = auth.uid() and role = 'superadmin' and is_active
  )
$$;

create function public.is_active_user() returns boolean
language sql stable security definer set search_path=''
as $$select exists(select 1 from public.profiles where id=auth.uid() and is_active)$$;

create or replace function public.is_teacher() returns boolean
language sql stable security definer set search_path=''
as $$select exists(select 1 from public.profiles where id=auth.uid() and role='teacher' and is_active)$$;

create or replace function public.owns_exam(target uuid) returns boolean
language sql stable security definer set search_path=''
as $$select public.is_teacher() and exists(select 1 from public.exams where id=target and created_by=auth.uid())$$;

drop policy if exists profiles_self on public.profiles;
create policy profiles_authorized_read on public.profiles for select to authenticated
using(id = auth.uid() or public.is_teacher() or public.is_superadmin());

create policy profiles_active_session on public.profiles as restrictive for select to authenticated
using(public.is_active_user());

create policy exams_active_session on public.exams as restrictive for all to authenticated using(public.is_active_user()) with check(public.is_active_user());
create policy access_codes_active_session on public.exam_access_codes as restrictive for all to authenticated using(public.is_active_user()) with check(public.is_active_user());
create policy sections_active_session on public.exam_sections as restrictive for all to authenticated using(public.is_active_user()) with check(public.is_active_user());
create policy questions_active_session on public.questions as restrictive for all to authenticated using(public.is_active_user()) with check(public.is_active_user());
create policy keys_active_session on public.question_keys as restrictive for all to authenticated using(public.is_active_user()) with check(public.is_active_user());
create policy attempts_active_session on public.exam_attempts as restrictive for all to authenticated using(public.is_active_user()) with check(public.is_active_user());
create policy section_attempts_active_session on public.section_attempts as restrictive for all to authenticated using(public.is_active_user()) with check(public.is_active_user());
create policy answers_active_session on public.answers as restrictive for all to authenticated using(public.is_active_user()) with check(public.is_active_user());
create policy results_active_session on public.answer_results as restrictive for all to authenticated using(public.is_active_user()) with check(public.is_active_user());
create policy import_batches_active_session on public.question_import_batches as restrictive for all to authenticated using(public.is_active_user()) with check(public.is_active_user());
create policy import_items_active_session on public.question_import_items as restrictive for all to authenticated using(public.is_active_user()) with check(public.is_active_user());
create policy audit_events_active_session on public.admin_audit_events as restrictive for all to authenticated using(public.is_active_user()) with check(public.is_active_user());
create policy cleanup_jobs_active_session on public.storage_cleanup_jobs as restrictive for all to authenticated using(public.is_active_user()) with check(public.is_active_user());
create policy duplication_jobs_active_session on public.exam_duplication_jobs as restrictive for all to authenticated using(public.is_active_user()) with check(public.is_active_user());
create policy retake_grants_active_session on public.exam_retake_grants as restrictive for all to authenticated using(public.is_active_user()) with check(public.is_active_user());
create policy key_corrections_active_session on public.answer_key_corrections as restrictive for all to authenticated using(public.is_active_user()) with check(public.is_active_user());

create function public.guard_active_actor() returns trigger
language plpgsql set search_path=''
as $$
begin
  if auth.uid() is not null and not public.is_active_user() then
    raise exception 'Account is inactive';
  end if;
  return new;
end
$$;
create trigger attempts_active_actor before insert or update on public.exam_attempts for each row execute function public.guard_active_actor();
create trigger section_attempts_active_actor before insert or update on public.section_attempts for each row execute function public.guard_active_actor();
create trigger answers_active_actor before insert or update on public.answers for each row execute function public.guard_active_actor();

create function public.admin_user_history_summary()
returns table(user_id uuid,exam_count bigint,attempt_count bigint,audit_count bigint)
language plpgsql stable security definer set search_path=''
as $$
begin
  if not public.is_superadmin() then raise exception 'Super Admin access required'; end if;
  return query
    select p.id,
      (select count(*) from public.exams e where e.created_by = p.id),
      (select count(*) from public.exam_attempts a where a.student_id = p.id),
      (select count(*) from public.admin_audit_events ae where ae.actor_id = p.id)
    from public.profiles p;
end
$$;

create function public.admin_update_user_profile(
  target_user uuid,
  new_full_name text,
  new_email text,
  new_role public.app_role,
  new_active boolean,
  change_reason text,
  operation_key uuid
) returns public.profiles
language plpgsql security definer set search_path=''
as $$
declare target public.profiles; result public.profiles; active_admins integer;
begin
  if not public.is_superadmin() then raise exception 'Super Admin access required'; end if;
  if exists(select 1 from public.admin_audit_events where actor_id=auth.uid() and idempotency_key=operation_key) then
    select * into result from public.profiles where id=target_user;
    return result;
  end if;
  select * into target from public.profiles where id=target_user for update;
  if target.id is null then raise exception 'User not found'; end if;
  if new_role is null then raise exception 'Invalid role'; end if;
  if length(trim(new_full_name)) not between 2 and 120 then raise exception 'Invalid full name'; end if;
  if new_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'Invalid email'; end if;
  if new_role is distinct from target.role and (
    exists(select 1 from public.exams where created_by=target.id)
    or exists(select 1 from public.exam_attempts where student_id=target.id)
  ) then raise exception 'Role cannot change after historical exam activity'; end if;
  if target.role='superadmin' and (new_role<>'superadmin' or not new_active) then
    select count(*) into active_admins from public.profiles where role='superadmin' and is_active;
    if active_admins <= 1 then raise exception 'Cannot remove the last active Super Admin'; end if;
  end if;
  if length(trim(coalesce(change_reason,''))) < 3 then raise exception 'A reason is required'; end if;
  update public.profiles set
      full_name=trim(new_full_name),email=lower(trim(new_email)),role=new_role,
      is_active=new_active,
      deactivated_at=case when new_active then null else coalesce(deactivated_at,now()) end,
      deactivated_by=case when new_active then null else auth.uid() end
    where id=target.id returning * into result;
  insert into public.admin_audit_events(actor_id,action,target_type,target_id,reason,before_state,after_state,idempotency_key)
    values(auth.uid(),'user.updated','user',target.id,trim(change_reason),
      jsonb_build_object('fullName',target.full_name,'email',target.email,'role',target.role,'active',target.is_active),
      jsonb_build_object('fullName',result.full_name,'email',result.email,'role',result.role,'active',result.is_active),operation_key);
  return result;
end
$$;

create function public.admin_assert_user_deletable(target_user uuid)
returns boolean
language plpgsql security definer set search_path=''
as $$
declare target public.profiles; active_admins integer;
begin
  if not public.is_superadmin() then raise exception 'Super Admin access required'; end if;
  select * into target from public.profiles where id=target_user for update;
  if target.id is null then raise exception 'User not found'; end if;
  if target.id=auth.uid() then raise exception 'You cannot delete your own account'; end if;
  if exists(select 1 from public.exams where created_by=target.id)
    or exists(select 1 from public.exam_attempts where student_id=target.id)
    or exists(select 1 from public.admin_audit_events where actor_id=target.id)
  then raise exception 'User has historical data and must be deactivated'; end if;
  if target.role='superadmin' then
    select count(*) into active_admins from public.profiles where role='superadmin' and is_active;
    if active_admins <= 1 then raise exception 'Cannot remove the last active Super Admin'; end if;
  end if;
  return true;
end
$$;

revoke all on function public.is_superadmin() from public,anon;
revoke all on function public.is_active_user() from public,anon;
revoke all on function public.admin_user_history_summary() from public,anon;
revoke all on function public.admin_update_user_profile(uuid,text,text,public.app_role,boolean,text,uuid) from public,anon;
revoke all on function public.admin_assert_user_deletable(uuid) from public,anon;
grant execute on function public.is_superadmin() to authenticated;
grant execute on function public.is_active_user() to authenticated;
grant execute on function public.admin_user_history_summary() to authenticated;
grant execute on function public.admin_update_user_profile(uuid,text,text,public.app_role,boolean,text,uuid) to authenticated;
grant execute on function public.admin_assert_user_deletable(uuid) to authenticated;
