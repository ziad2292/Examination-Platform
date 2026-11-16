-- Summit SAT feature expansion: ownership, assignments, per-exam/module settings,
-- and protected bulk administration. Existing students remain unassigned unless
-- their historical attempts identify an exam owner; historical attempts are
-- grandfathered into exam assignments without altering answers or grades.

alter table public.profiles
  add column teacher_id uuid references public.profiles(id) on delete set null;

alter table public.exams
  add column show_results_to_students boolean not null default true;
alter table public.exams alter column show_results_to_students set default false;

alter table public.exam_sections
  add column allow_calculator boolean not null default true;
alter table public.exam_sections alter column allow_calculator set default false;

create index profiles_teacher_idx on public.profiles(teacher_id,role,is_active);

create table public.exam_student_assignments (
  exam_id uuid not null references public.exams(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  assigned_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key(exam_id,student_id)
);
create index exam_student_assignments_student_idx
  on public.exam_student_assignments(student_id,exam_id);

-- Preserve established ownership only where history gives an unambiguous owner.
update public.profiles p set teacher_id=owners.teacher_id
from (
  select a.student_id,min(e.created_by::text)::uuid teacher_id
  from public.exam_attempts a join public.exams e on e.id=a.exam_id
  group by a.student_id having count(distinct e.created_by)=1
) owners
where p.id=owners.student_id and p.role='student' and p.teacher_id is null;

insert into public.exam_student_assignments(exam_id,student_id,assigned_by)
select distinct a.exam_id,a.student_id,e.created_by
from public.exam_attempts a join public.exams e on e.id=a.exam_id
on conflict do nothing;

create function public.can_manage_student(target_student uuid) returns boolean
language sql stable security definer set search_path=''
as $$
  select public.is_superadmin() or exists(
    select 1 from public.profiles p
    where p.id=target_student and p.role='student' and p.teacher_id=auth.uid()
      and public.is_teacher()
  )
$$;

create function public.student_can_access_exam(target_exam uuid,target_student uuid default auth.uid()) returns boolean
language sql stable security definer set search_path=''
as $$
  select exists(
    select 1 from public.exam_student_assignments x
    join public.exams e on e.id=x.exam_id
    join public.profiles s on s.id=x.student_id
    where x.exam_id=target_exam and x.student_id=target_student
      and s.role='student' and s.is_active
      and s.teacher_id=e.created_by
  ) or exists(
    select 1 from public.exam_attempts a
    where a.exam_id=target_exam and a.student_id=target_student
  )
$$;

create function public.can_read_student_score(target_exam uuid,target_student uuid) returns boolean
language sql stable security definer set search_path=''
as $$
  select public.is_superadmin()
    or public.owns_exam(target_exam)
    or (target_student=auth.uid() and exists(
      select 1 from public.exams e where e.id=target_exam and e.show_results_to_students
    ))
$$;

alter table public.exam_student_assignments enable row level security;
create policy exam_assignments_teacher_read on public.exam_student_assignments for select to authenticated
using(public.is_superadmin() or public.owns_exam(exam_id) or student_id=auth.uid());
create policy exam_assignments_active_session on public.exam_student_assignments as restrictive for all to authenticated
using(public.is_active_user()) with check(public.is_active_user());

drop policy if exists profiles_authorized_read on public.profiles;
create policy profiles_authorized_read on public.profiles for select to authenticated
using(id=auth.uid() or public.is_superadmin() or (public.is_teacher() and teacher_id=auth.uid()));

drop policy if exists exams_student_read on public.exams;
create policy exams_student_read on public.exams for select to authenticated
using(status in('published','closed') and public.student_can_access_exam(id));
create policy exams_superadmin_read on public.exams for select to authenticated
using(public.is_superadmin());

drop policy if exists access_codes_teacher_all on public.exam_access_codes;
create policy access_codes_manager_read on public.exam_access_codes for select to authenticated
using(public.owns_exam(exam_id) or public.is_superadmin());
create policy access_codes_teacher_write on public.exam_access_codes for all to authenticated
using(public.owns_exam(exam_id)) with check(public.owns_exam(exam_id));

drop policy if exists sections_student_read on public.exam_sections;
create policy sections_student_read on public.exam_sections for select to authenticated
using(exists(select 1 from public.exams e where e.id=exam_id and e.status in('published','closed')
  and public.student_can_access_exam(e.id)));
create policy sections_superadmin_read on public.exam_sections for select to authenticated using(public.is_superadmin());

drop policy if exists questions_student_read on public.questions;
create policy questions_student_read on public.questions for select to authenticated
using(exists(select 1 from public.exam_sections s join public.exams e on e.id=s.exam_id
  where s.id=section_id and e.status in('published','closed') and public.student_can_access_exam(e.id)));
create policy questions_superadmin_read on public.questions for select to authenticated using(public.is_superadmin());

drop policy if exists attempts_owner_read on public.exam_attempts;
create policy attempts_authorized_read on public.exam_attempts for select to authenticated
using(
  public.is_superadmin() or public.owns_exam(exam_id)
  or (student_id=auth.uid() and (status='in_progress' or public.can_read_student_score(exam_id,student_id)))
);

create or replace function public.start_exam(target_exam uuid,target_code text default null)
returns public.exam_attempts language plpgsql security definer set search_path=''
as $$
declare e public.exams; current_attempt public.exam_attempts; result public.exam_attempts; grant_row public.exam_retake_grants; next_generation integer;
begin
  select * into e from public.exams where id=target_exam for update;
  if e.id is null then raise exception 'Exam not found'; end if;
  if exists(select 1 from public.profiles where id=auth.uid() and not is_active) then raise exception 'Account is inactive'; end if;
  if not exists(select 1 from public.profiles where id=auth.uid() and role='student' and is_active) then raise exception 'Student account required'; end if;
  if not public.student_can_access_exam(target_exam,auth.uid()) then raise exception 'Student is not assigned to this exam'; end if;
  if e.status='closed' or now()>=e.scheduled_end_at then raise exception 'Exam is closed'; end if;
  if e.status<>'published' then raise exception 'Exam is not available'; end if;
  if now()<e.scheduled_start_at then raise exception 'Exam has not started'; end if;
  if e.access_code_required and not exists(select 1 from public.exam_access_codes c where c.exam_id=e.id and c.access_code=target_code) then raise exception 'Invalid access code'; end if;
  select * into current_attempt from public.exam_attempts where exam_id=target_exam and student_id=auth.uid() order by generation desc limit 1 for update;
  if current_attempt.id is null then
    insert into public.exam_attempts(exam_id,student_id,generation) values(target_exam,auth.uid(),1) returning * into result; return result;
  end if;
  if current_attempt.status='in_progress' then
    update public.exam_attempts set last_seen_at=now() where id=current_attempt.id returning * into result; return result;
  end if;
  select * into grant_row from public.exam_retake_grants where exam_id=target_exam and student_id=auth.uid() and consumed_at is null order by created_at limit 1 for update;
  if grant_row.id is null then raise exception 'Retake authorization required'; end if;
  next_generation:=current_attempt.generation+1;
  insert into public.exam_attempts(exam_id,student_id,generation) values(target_exam,auth.uid(),next_generation) returning * into result;
  update public.exam_attempts set superseded_at=now(),superseded_by=result.id where id=current_attempt.id;
  update public.exam_retake_grants set consumed_at=now(),consumed_by_attempt_id=result.id where id=grant_row.id;
  return result;
end $$;

create function public.set_exam_student_assignments(target_exam uuid,target_students uuid[])
returns integer language plpgsql security definer set search_path=''
as $$
declare owner uuid; requested uuid[]:=coalesce(target_students,array[]::uuid[]); changed integer;
begin
  select created_by into owner from public.exams where id=target_exam for update;
  if owner is null or not public.owns_exam(target_exam) then raise exception 'Exam not found'; end if;
  if exists(select 1 from unnest(requested) s(id) left join public.profiles p on p.id=s.id
    where p.id is null or p.role<>'student' or not p.is_active or p.teacher_id is distinct from owner)
  then raise exception 'Only your active students can be assigned'; end if;
  if exists(select 1 from public.exam_student_assignments x
    where x.exam_id=target_exam and not (x.student_id=any(requested))
      and exists(select 1 from public.exam_attempts a where a.exam_id=target_exam and a.student_id=x.student_id))
  then raise exception 'Students with attempts cannot be removed'; end if;
  delete from public.exam_student_assignments x where x.exam_id=target_exam
    and not (x.student_id=any(requested));
  insert into public.exam_student_assignments(exam_id,student_id,assigned_by)
    select target_exam,id,auth.uid() from unnest(requested) s(id) on conflict do nothing;
  get diagnostics changed=row_count;
  return changed;
end $$;

create function public.admin_assign_students_to_teacher(target_students uuid[],target_teacher uuid)
returns integer language plpgsql security definer set search_path=''
as $$
declare changed integer;
begin
  if not public.is_superadmin() then raise exception 'Super Admin access required'; end if;
  if target_teacher is not null and not exists(select 1 from public.profiles where id=target_teacher and role='teacher' and is_active) then raise exception 'Active teacher required'; end if;
  if exists(select 1 from public.exam_attempts a join public.exams e on e.id=a.exam_id
    where a.student_id=any(target_students) and target_teacher is distinct from e.created_by)
  then raise exception 'Reassignment conflicts with historical exam ownership'; end if;
  update public.profiles set teacher_id=target_teacher where id=any(target_students) and role='student';
  get diagnostics changed=row_count;
  return changed;
end $$;

create function public.update_exam_feature_settings(target_exam uuid,show_results boolean)
returns void language plpgsql security definer set search_path=''
as $$ begin
  if not public.owns_exam(target_exam) then raise exception 'Exam not found'; end if;
  update public.exams set show_results_to_students=show_results where id=target_exam;
end $$;

create function public.update_section_settings(target_section uuid,new_duration_seconds integer,new_allow_calculator boolean)
returns void language plpgsql security definer set search_path=''
as $$
declare target_exam uuid;
begin
  select exam_id into target_exam from public.exam_sections where id=target_section for update;
  if target_exam is null or not public.owns_exam(target_exam) then raise exception 'Section not found'; end if;
  if new_duration_seconds not between 60 and 14400 then raise exception 'Duration must be between 1 and 240 minutes'; end if;
  if exists(select 1 from public.exam_attempts where exam_id=target_exam) then raise exception 'Section settings are locked after the first attempt'; end if;
  update public.exam_sections set duration_seconds=new_duration_seconds,allow_calculator=new_allow_calculator where id=target_section;
end $$;

create function public.student_attempt_summary(target_attempt uuid)
returns table(id uuid,status public.attempt_status,raw_score integer,total_questions integer,exam_id uuid,exam_title text,results_visible boolean)
language sql stable security definer set search_path=''
as $$
 select a.id,a.status,
   case when e.show_results_to_students then a.raw_score else null end,
   case when e.show_results_to_students then a.total_questions else null end,
   e.id,e.title,e.show_results_to_students
 from public.exam_attempts a join public.exams e on e.id=a.exam_id
 where a.id=target_attempt and a.student_id=auth.uid()
$$;

create function public.student_exam_attempt_summary(target_exam uuid)
returns table(id uuid,generation integer,status public.attempt_status,raw_score integer,total_questions integer,results_visible boolean)
language sql stable security definer set search_path=''
as $$
 select a.id,a.generation,a.status,
   case when e.show_results_to_students then a.raw_score else null end,
   case when e.show_results_to_students then a.total_questions else null end,
   e.show_results_to_students
 from public.exam_attempts a join public.exams e on e.id=a.exam_id
 where a.exam_id=target_exam and a.student_id=auth.uid()
 order by a.generation desc limit 1
$$;

create function public.admin_cleanup_preview()
returns jsonb language plpgsql stable security definer set search_path=''
as $$ begin
  if not public.is_superadmin() then raise exception 'Super Admin access required'; end if;
  return jsonb_build_object(
    'exams',(select count(*) from public.exams),
    'students',(select count(*) from public.profiles where role='student'),
    'attempts',(select count(*) from public.exam_attempts),
    'answers',(select count(*) from public.answers));
end $$;

create function public.admin_delete_students(target_students uuid[],confirmation_count integer)
returns uuid[] language plpgsql security definer set search_path=''
as $$
declare selected uuid[];
begin
  if not public.is_superadmin() then raise exception 'Super Admin access required'; end if;
  select coalesce(array_agg(id order by id),array[]::uuid[]) into selected
    from public.profiles where id=any(target_students) and role='student';
  if cardinality(selected)=0 or cardinality(selected)<>confirmation_count then raise exception 'Student selection changed; review and confirm again'; end if;
  delete from public.exam_attempts where student_id=any(selected);
  delete from public.exam_student_assignments where student_id=any(selected);
  delete from public.profiles where id=any(selected) and role='student';
  insert into public.admin_audit_events(actor_id,action,target_type,target_id,reason,after_state)
    values(auth.uid(),'user.bulk_deleted','system',gen_random_uuid(),'Confirmed bulk student deletion',jsonb_build_object('count',cardinality(selected)));
  return selected;
end $$;

create function public.admin_factory_cleanup(cleanup_scope text,confirmation text,operation_key uuid)
returns uuid[] language plpgsql security definer set search_path=''
as $$
declare students uuid[]:=array[]::uuid[]; expected text; token_iat bigint;
begin
  if not public.is_superadmin() then raise exception 'Super Admin access required'; end if;
  expected:=case cleanup_scope when 'exams' then 'DELETE ALL EXAMS' when 'students' then 'DELETE ALL STUDENTS' when 'all' then 'DELETE ALL EXAMS AND STUDENTS' else null end;
  if expected is null or confirmation is distinct from expected then raise exception 'Confirmation phrase did not match'; end if;
  token_iat:=coalesce((auth.jwt()->>'iat')::bigint,0);
  if extract(epoch from now())::bigint-token_iat>600 then raise exception 'Recent authentication required'; end if;
  if exists(select 1 from public.admin_audit_events where actor_id=auth.uid() and action='system.factory_cleanup' and idempotency_key=operation_key) then return students; end if;
  if cleanup_scope in ('students','all') then select coalesce(array_agg(id),array[]::uuid[]) into students from public.profiles where role='student'; end if;
  if cleanup_scope in ('exams','all') then
    delete from public.admin_audit_events where exam_id is not null;
    delete from public.exam_retake_grants;
    delete from public.answer_key_corrections;
    delete from public.exam_attempts;
    delete from public.exam_duplication_jobs;
    delete from public.exams;
  end if;
  if cleanup_scope in ('students','all') then
    delete from public.exam_attempts where student_id=any(students);
    delete from public.exam_student_assignments where student_id=any(students);
    delete from public.profiles where id=any(students) and role='student';
  end if;
  insert into public.admin_audit_events(actor_id,action,target_type,target_id,reason,after_state,idempotency_key)
    values(auth.uid(),'system.factory_cleanup','system',operation_key,'Confirmed protected bulk cleanup',jsonb_build_object('scope',cleanup_scope,'students',cardinality(students)),operation_key);
  return students;
end $$;

revoke all on function public.can_manage_student(uuid) from public,anon;
revoke all on function public.student_can_access_exam(uuid,uuid) from public,anon;
revoke all on function public.can_read_student_score(uuid,uuid) from public,anon;
revoke all on function public.set_exam_student_assignments(uuid,uuid[]) from public,anon;
revoke all on function public.admin_assign_students_to_teacher(uuid[],uuid) from public,anon;
revoke all on function public.update_exam_feature_settings(uuid,boolean) from public,anon;
revoke all on function public.update_section_settings(uuid,integer,boolean) from public,anon;
revoke all on function public.student_attempt_summary(uuid) from public,anon;
revoke all on function public.student_exam_attempt_summary(uuid) from public,anon;
revoke all on function public.admin_cleanup_preview() from public,anon;
revoke all on function public.admin_delete_students(uuid[],integer) from public,anon;
revoke all on function public.admin_factory_cleanup(text,text,uuid) from public,anon;
grant execute on function public.can_manage_student(uuid),public.student_can_access_exam(uuid,uuid),public.can_read_student_score(uuid,uuid),public.set_exam_student_assignments(uuid,uuid[]),public.admin_assign_students_to_teacher(uuid[],uuid),public.update_exam_feature_settings(uuid,boolean),public.update_section_settings(uuid,integer,boolean),public.student_attempt_summary(uuid),public.student_exam_attempt_summary(uuid),public.admin_cleanup_preview(),public.admin_delete_students(uuid[],integer),public.admin_factory_cleanup(text,text,uuid) to authenticated;
