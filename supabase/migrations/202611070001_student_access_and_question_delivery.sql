alter table public.profiles add column self_registered_at timestamptz,
  add column approval_status text not null default 'approved'
  check (approval_status in ('pending','approved','rejected')),
  add constraint approval_requires_inactive check (approval_status='approved' or not is_active);

create function public.register_student_profile() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.raw_user_meta_data->>'assessly_registration' = 'student'
    and length(trim(new.raw_user_meta_data->>'full_name')) between 2 and 120
    and new.email is not null then
    insert into public.profiles(id,full_name,email,role,is_active,deactivated_at,approval_status,self_registered_at)
    values(new.id,trim(new.raw_user_meta_data->>'full_name'),new.email,'student',false,now(),'pending',now());
  end if;
  return new;
end $$;
create trigger register_student_profile after insert on auth.users
for each row execute function public.register_student_profile();

create function public.my_registration_status() returns text
language sql stable security definer set search_path='' as $$
  select approval_status from public.profiles where id=auth.uid() and role='student'
$$;

create function public.review_student_registration(student uuid, approve boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not public.is_superadmin() then raise exception 'Administrator access required' using errcode='42501'; end if;
  if approve and not exists(select 1 from auth.users where id=student and email_confirmed_at is not null)
    then raise exception 'The student must verify their email first'; end if;
  update public.profiles set approval_status=case when approve then 'approved' else 'rejected' end,
    is_active=approve,deactivated_at=case when approve then null else now() end
  where id=student and role='student' and approval_status='pending';
end $$;

create table public.student_teachers (
  student_id uuid not null references public.profiles(id) on delete cascade,
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  primary key(student_id,teacher_id),
  check(student_id<>teacher_id)
);
create index student_teachers_teacher_idx on public.student_teachers(teacher_id,student_id);
insert into public.student_teachers select p.id,p.teacher_id from public.profiles p
join public.profiles t on t.id=p.teacher_id where p.role='student' and t.role='teacher';

-- Preserve compatibility with existing account provisioning and legacy assignment calls.
create function public.sync_legacy_student_teacher() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' then
    if new.teacher_id is not distinct from old.teacher_id then return new; end if;
    delete from public.student_teachers where student_id=old.id and teacher_id=old.teacher_id;
  end if;
  if new.role='student' and new.teacher_id is not null then
    insert into public.student_teachers values(new.id,new.teacher_id) on conflict do nothing;
  end if;
  return new;
end $$;
create trigger sync_legacy_student_teacher after insert or update of teacher_id on public.profiles
for each row execute function public.sync_legacy_student_teacher();

alter table public.student_teachers enable row level security;
revoke all on public.student_teachers from public,anon,authenticated;
grant select on public.student_teachers to authenticated;
create policy student_teachers_read on public.student_teachers for select to authenticated using (
  public.is_active_user() and (student_id=auth.uid() or public.is_superadmin()
  or (teacher_id=auth.uid() and public.is_teacher()))
);

create or replace function public.can_manage_student(target_student uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select public.is_superadmin() or (public.is_teacher() and exists(
    select 1 from public.student_teachers where student_id=target_student and teacher_id=auth.uid()
  ))
$$;
drop policy profiles_authorized_read on public.profiles;
create policy profiles_authorized_read on public.profiles for select to authenticated using(
  id=auth.uid() or public.is_superadmin() or (role='student' and public.can_manage_student(id))
);

create or replace function public.student_can_access_exam(target_exam uuid,target_student uuid default auth.uid()) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles s where s.id=target_student and s.role='student' and s.is_active)
  and (
    exists(select 1 from public.exam_student_assignments a join public.exams e on e.id=a.exam_id
      join public.student_teachers t on t.student_id=a.student_id and t.teacher_id=e.created_by
      where a.exam_id=target_exam and a.student_id=target_student)
    or exists(select 1 from public.exam_attempts where exam_id=target_exam and student_id=target_student)
  )
$$;

create or replace function public.set_exam_student_assignments(target_exam uuid,target_students uuid[])
returns integer language plpgsql security definer set search_path=''
as $$
declare owner uuid; requested uuid[]:=coalesce(target_students,array[]::uuid[]); changed integer;
begin
  select created_by into owner from public.exams where id=target_exam for update;
  if owner is null or not public.owns_exam(target_exam) then raise exception 'Exam not found'; end if;
  if exists(select 1 from unnest(requested) s(id) left join public.profiles p on p.id=s.id
    where p.id is null or p.role<>'student' or not p.is_active or not exists(select 1 from public.student_teachers t where t.student_id=p.id and t.teacher_id=owner))
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

create function public.change_student_teacher_links(students uuid[], teacher uuid, remove_link boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not public.is_superadmin() then raise exception 'Administrator access required' using errcode='42501'; end if;
  perform 1 from public.profiles where id=any(students) order by id for update;
  if remove_link then
    update public.profiles set teacher_id=null where id=any(students) and teacher_id=teacher and role='student';
    delete from public.student_teachers where student_id=any(students) and teacher_id=teacher;
  else
    if not exists(select 1 from public.profiles where id=teacher and role='teacher' and is_active)
      then raise exception 'Active teacher required'; end if;
    insert into public.student_teachers
    select id,teacher from public.profiles where id=any(students) and role='student' and is_active
    on conflict do nothing;
  end if;
end $$;

alter table public.exams add column randomize_questions boolean not null default false;
alter table public.exam_attempts add column question_sequence uuid[];
create function public.capture_attempt_question_sequence() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.exams where id=new.exam_id and randomize_questions) then
    select array_agg(q.id order by s.section_order,random()) into new.question_sequence
    from public.questions q join public.exam_sections s on s.id=q.section_id where s.exam_id=new.exam_id;
  end if;
  return new;
end $$;
create trigger capture_attempt_question_sequence before insert on public.exam_attempts
for each row execute function public.capture_attempt_question_sequence();

create function public.set_exam_randomization(exam uuid, enabled boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not public.owns_exam(exam) then raise exception 'Exam not found'; end if;
  perform 1 from public.exams where id=exam for update;
  update public.exams set randomize_questions=enabled where id=exam and status='draft'
    and not exists(select 1 from public.exam_attempts where exam_id=exam);
  if not found then raise exception 'Question delivery is locked'; end if;
end $$;
create function public.guard_exam_randomization() returns trigger language plpgsql set search_path='' as $$
begin
  if old.randomize_questions is distinct from new.randomize_questions and
    (old.status<>'draft' or new.status<>'draft' or exists(select 1 from public.exam_attempts where exam_id=old.id))
    then raise exception 'Question delivery is locked'; end if;
  return new;
end $$;
create trigger guard_exam_randomization before update on public.exams
for each row execute function public.guard_exam_randomization();

create function public.my_assigned_teachers() returns table(id uuid, full_name text)
language sql stable security definer set search_path='' as $$
  select p.id,p.full_name from public.student_teachers t join public.profiles p on p.id=t.teacher_id
  where t.student_id=auth.uid() and p.role='teacher' and p.is_active and public.is_active_user()
  order by p.full_name,p.id
$$;
revoke all on function public.my_assigned_teachers() from public,anon;
grant execute on function public.my_assigned_teachers() to authenticated;

create function public.my_exam_history() returns table(
  id uuid, title text, started_at timestamptz, status public.attempt_status, raw_score integer,total_questions integer
) language sql stable security definer set search_path='' as $$
  select a.id,e.title,a.started_at,a.status,
    case when e.show_results_to_students and a.status='completed' then a.raw_score end,
    case when e.show_results_to_students and a.status='completed' then a.total_questions end
  from public.exam_attempts a join public.exams e on e.id=a.exam_id
  where a.student_id=auth.uid() and public.is_active_user()
  order by a.started_at desc,a.id desc
$$;

revoke all on function public.my_registration_status(),public.review_student_registration(uuid,boolean),
  public.change_student_teacher_links(uuid[],uuid,boolean),public.set_exam_randomization(uuid,boolean),
  public.my_exam_history() from public,anon;
grant execute on function public.my_registration_status(),public.review_student_registration(uuid,boolean),
  public.change_student_teacher_links(uuid[],uuid,boolean),public.set_exam_randomization(uuid,boolean),
  public.my_exam_history() to authenticated;
