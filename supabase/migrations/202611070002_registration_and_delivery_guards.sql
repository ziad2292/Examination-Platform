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
  if current_attempt.status is distinct from 'in_progress' and not exists(
    select 1 from public.exam_student_assignments x join public.student_teachers t
      on t.student_id=x.student_id and t.teacher_id=e.created_by
    where x.exam_id=e.id and x.student_id=auth.uid()
  ) then raise exception 'Student is not assigned to this exam'; end if;
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

create function public.copy_question_delivery() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.status='completed' and old.status is distinct from new.status then
    update public.exams target set randomize_questions=source.randomize_questions
    from public.exams source where target.id=new.target_exam_id and source.id=new.source_exam_id;
  end if;
  return new;
end $$;
create trigger copy_question_delivery after update on public.exam_duplication_jobs
for each row execute function public.copy_question_delivery();

create function public.registration_email_checks(students uuid[]) returns table(id uuid, verified boolean)
language sql stable security definer set search_path='' as $$
  select u.id,u.email_confirmed_at is not null from auth.users u
  join public.profiles p on p.id=u.id
  where public.is_superadmin() and u.id=any(students) and p.self_registered_at is not null
$$;
revoke all on function public.registration_email_checks(uuid[]) from public,anon;
grant execute on function public.registration_email_checks(uuid[]) to authenticated;

drop function public.review_student_registration(uuid,boolean);
create function public.review_student_registration(student uuid, approve boolean, note text default null) returns void
language plpgsql security definer set search_path='' as $$
declare decision text := case when approve then 'approved' else 'rejected' end;
begin
  if not public.is_superadmin() then raise exception 'Administrator access required' using errcode='42501'; end if;
  if approve is null or length(note)>1000 then raise exception 'Invalid decision'; end if;
  if approve and not exists(select 1 from auth.users where id=student and email_confirmed_at is not null)
    then raise exception 'The student must verify their email first'; end if;
  update public.profiles set approval_status=decision,
    is_active=approve,deactivated_at=case when approve then null else now() end
  where id=student and role='student' and approval_status='pending';
  if found then
    insert into public.admin_audit_events(actor_id,action,target_type,target_id,reason,after_state)
    values(auth.uid(),'registration.'||decision,'profile',student,case when length(trim(note))>=3 then trim(note) end,jsonb_build_object('approval_status',decision));
  elsif not exists(select 1 from public.profiles where id=student and self_registered_at is not null and approval_status=decision) then
    raise exception 'This request is no longer pending';
  end if;
end $$;
revoke all on function public.review_student_registration(uuid,boolean,text) from public,anon;
grant execute on function public.review_student_registration(uuid,boolean,text) to authenticated;
