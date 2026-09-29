alter table public.answers
  add constraint answers_client_revision_nonnegative check (client_revision >= 0);

alter table public.section_attempts
  add constraint section_attempt_time_order check (expires_at > started_at);

alter table public.exam_attempts
  add constraint completed_attempt_has_result check (
    (status = 'completed' and completed_at is not null and raw_score is not null and total_questions is not null)
    or status <> 'completed'
  ),
  add constraint attempt_score_range check (
    raw_score is null or total_questions is null
    or (raw_score >= 0 and total_questions >= 0 and raw_score <= total_questions)
  );

create or replace function public.guard_exam_update() returns trigger
language plpgsql set search_path=''
as $$
declare
  module_without_questions boolean;
  question_without_key boolean;
begin
  if exists(select 1 from public.exam_attempts where exam_id=old.id)
    and row(new.title,new.description,new.access_code_required,new.scheduled_start_at,new.scheduled_end_at)
      is distinct from
        row(old.title,old.description,old.access_code_required,old.scheduled_start_at,old.scheduled_end_at)
  then
    raise exception 'Exam configuration is locked after the first attempt';
  end if;

  if (old.status='published' and new.status='draft')
    or (old.status='closed' and new.status in ('draft','published'))
    or (old.status='archived' and new.status<>'archived')
  then
    raise exception 'Illegal exam status transition';
  end if;

  if new.status='archived' and old.status<>'archived'
    and exists(select 1 from public.exam_attempts where exam_id=old.id and status='in_progress')
  then
    raise exception 'Cannot archive an exam with active attempts';
  end if;

  if new.status='published' and old.status<>'published' then
    if not exists(select 1 from public.exam_sections where exam_id=old.id) then
      raise exception 'An exam needs at least one section before publishing';
    end if;

    select exists(
      select 1 from public.exam_sections s
      where s.exam_id=old.id and s.section_type='module'
        and not exists(select 1 from public.questions q where q.section_id=s.id)
    ) into module_without_questions;
    if module_without_questions then
      raise exception 'Every module needs at least one question';
    end if;

    select exists(
      select 1 from public.questions q
      join public.exam_sections s on s.id=q.section_id
      where s.exam_id=old.id
        and not exists(select 1 from public.question_keys k where k.question_id=q.id)
    ) into question_without_key;
    if question_without_key then
      raise exception 'Every question needs an answer key';
    end if;

    if new.access_code_required and not exists(
      select 1 from public.exam_access_codes where exam_id=old.id
    ) then
      raise exception 'An access code is required before publishing';
    end if;
  end if;

  return new;
end
$$;

create function public.guard_access_code_change() returns trigger
language plpgsql set search_path=''
as $$
declare
  target_exam uuid := case when tg_op='DELETE' then old.exam_id else new.exam_id end;
begin
  if exists(select 1 from public.exam_attempts where exam_id=target_exam) then
    raise exception 'Exam configuration is locked after the first attempt';
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end
$$;

create trigger access_codes_lock
before insert or update or delete on public.exam_access_codes
for each row execute function public.guard_access_code_change();

create function public.guard_attempt_transition() returns trigger
language plpgsql set search_path=''
as $$
begin
  if old.status in ('completed','expired') and new.status is distinct from old.status then
    raise exception 'Attempt is already in a terminal state';
  end if;
  return new;
end
$$;

create function public.guard_section_attempt_transition() returns trigger
language plpgsql set search_path=''
as $$
begin
  if old.status in ('submitted','expired') and new.status is distinct from old.status then
    raise exception 'Section is already in a terminal state';
  end if;
  if new.status in ('submitted','expired') and new.submitted_at is null then
    raise exception 'A finished section requires a submission timestamp';
  end if;
  return new;
end
$$;

create trigger attempts_state_guard
before update on public.exam_attempts
for each row execute function public.guard_attempt_transition();

create trigger section_attempts_state_guard
before update on public.section_attempts
for each row execute function public.guard_section_attempt_transition();

drop policy sections_teacher_all on public.exam_sections;
create policy sections_teacher_read on public.exam_sections for select
using(public.owns_exam(exam_id));

drop policy sections_student_read on public.exam_sections;
create policy sections_student_read on public.exam_sections for select
using(auth.uid() is not null and exists(
  select 1 from public.exams e
  where e.id=exam_id and e.status in('published','closed')
));

drop policy questions_teacher_all on public.questions;
create policy questions_teacher_read on public.questions for select
using(exists(
  select 1 from public.exam_sections s
  where s.id=section_id and public.owns_exam(s.exam_id)
));

drop policy questions_student_read on public.questions;
create policy questions_student_read on public.questions for select
using(auth.uid() is not null and exists(
  select 1 from public.exam_sections s
  join public.exam_attempts a on a.exam_id=s.exam_id
  where s.id=section_id and a.student_id=auth.uid()
));

drop policy keys_teacher_only on public.question_keys;
create policy keys_teacher_read on public.question_keys for select
using(exists(
  select 1 from public.questions q
  join public.exam_sections s on s.id=q.section_id
  where q.id=question_id and public.owns_exam(s.exam_id)
));

create function public.create_section(
  target_exam uuid,
  new_title text,
  new_type public.section_type,
  new_duration_seconds integer
) returns public.exam_sections
language plpgsql security definer set search_path=''
as $$
declare
  result public.exam_sections;
  next_order integer;
begin
  perform 1 from public.exams where id=target_exam for update;
  if not public.owns_exam(target_exam) then raise exception 'Exam not found'; end if;
  if exists(select 1 from public.exam_attempts where exam_id=target_exam) then
    raise exception 'Exam is locked';
  end if;
  if length(trim(new_title)) not between 2 and 120 then
    raise exception 'Invalid section title';
  end if;
  if new_duration_seconds not between 60 and 14400 then
    raise exception 'Invalid section duration';
  end if;

  select coalesce(max(section_order),0)+1 into next_order
    from public.exam_sections where exam_id=target_exam;
  insert into public.exam_sections(exam_id,title,section_type,section_order,duration_seconds)
    values(target_exam,trim(new_title),new_type,next_order,new_duration_seconds)
    returning * into result;
  return result;
end
$$;

create function public.create_question(
  target_exam uuid,
  target_section uuid,
  question_text text,
  answer_a text,
  answer_b text,
  answer_c text,
  answer_d text,
  correct public.answer_option,
  stored_image_path text default null
) returns public.questions
language plpgsql security definer set search_path=''
as $$
declare
  result public.questions;
  next_order integer;
begin
  perform 1 from public.exam_sections
    where id=target_section and exam_id=target_exam for update;
  if not found or not public.owns_exam(target_exam) then
    raise exception 'Section not found';
  end if;
  if exists(select 1 from public.exam_attempts where exam_id=target_exam) then
    raise exception 'Exam is locked';
  end if;
  if question_text is not null and length(question_text)>10000 then
    raise exception 'Question text is too long';
  end if;
  if length(trim(answer_a)) not between 1 and 2000
    or length(trim(answer_b)) not between 1 and 2000
    or length(trim(answer_c)) not between 1 and 2000
    or length(trim(answer_d)) not between 1 and 2000
  then
    raise exception 'Invalid answer option';
  end if;

  select coalesce(max(question_order),0)+1 into next_order
    from public.questions where section_id=target_section;
  insert into public.questions(
    section_id,question_order,image_path,optional_text,option_a,option_b,option_c,option_d
  ) values(
    target_section,next_order,stored_image_path,nullif(trim(question_text),''),
    trim(answer_a),trim(answer_b),trim(answer_c),trim(answer_d)
  ) returning * into result;
  insert into public.question_keys(question_id,correct_option) values(result.id,correct);
  return result;
end
$$;

revoke all on function public.create_section(uuid,text,public.section_type,integer) from public;
grant execute on function public.create_section(uuid,text,public.section_type,integer) to authenticated;
revoke all on function public.create_question(uuid,uuid,text,text,text,text,text,public.answer_option,text) from public;
grant execute on function public.create_question(uuid,uuid,text,text,text,text,text,public.answer_option,text) to authenticated;

create policy question_images_teacher_delete on storage.objects for delete to authenticated
using(bucket_id='question-images' and public.is_teacher());

update storage.buckets set public=false where id='question-images';
drop policy question_images_public_read on storage.objects;
create policy question_images_authorized_read on storage.objects for select to authenticated
using(
  bucket_id='question-images' and exists(
    select 1
    from public.questions q
    join public.exam_sections s on s.id=q.section_id
    where q.image_path=storage.objects.name
      and (
        public.owns_exam(s.exam_id)
        or exists(
          select 1 from public.exam_attempts a
          where a.exam_id=s.exam_id and a.student_id=auth.uid()
        )
      )
  )
);

create or replace function public.submit_section(target_section_attempt uuid) returns void
language plpgsql security definer set search_path=''
as $$
declare
  sa public.section_attempts;
  a public.exam_attempts;
  remaining integer;
  score integer;
  total integer;
begin
  select * into sa from public.section_attempts
    where id=target_section_attempt for update;
  select * into a from public.exam_attempts
    where id=sa.exam_attempt_id and student_id=auth.uid() for update;

  if a.id is null then raise exception 'Attempt not found'; end if;
  if a.status='completed' then return; end if;
  if a.status<>'in_progress' then raise exception 'Attempt is not active'; end if;

  if sa.status='in_progress' then
    update public.section_attempts
      set status=case when now()>=expires_at
        then 'expired'::public.section_attempt_status
        else 'submitted'::public.section_attempt_status end,
          submitted_at=now()
      where id=sa.id;
  end if;

  select count(*) into remaining
    from public.exam_sections s
    where s.exam_id=a.exam_id
      and not exists(
        select 1 from public.section_attempts x
        where x.exam_attempt_id=a.id and x.section_id=s.id
          and x.status in('submitted','expired')
      );

  if remaining=0 then
    insert into public.answer_results(answer_id,is_correct)
      select ans.id,ans.selected_option=k.correct_option
      from public.answers ans
      join public.question_keys k on k.question_id=ans.question_id
      where ans.exam_attempt_id=a.id
      on conflict(answer_id) do update
        set is_correct=excluded.is_correct,graded_at=now();

    select count(*) filter(where r.is_correct),count(q.id) into score,total
      from public.exam_sections s
      join public.questions q on q.section_id=s.id
      left join public.answers ans
        on ans.question_id=q.id and ans.exam_attempt_id=a.id
      left join public.answer_results r on r.answer_id=ans.id
      where s.exam_id=a.exam_id;

    update public.exam_attempts
      set status='completed',completed_at=now(),raw_score=score,total_questions=total
      where id=a.id;
  end if;
end
$$;

create function public.reconcile_section(target_section_attempt uuid)
returns public.section_attempt_status
language plpgsql security definer set search_path=''
as $$
declare
  current_status public.section_attempt_status;
begin
  select sa.status into current_status
    from public.section_attempts sa
    join public.exam_attempts a on a.id=sa.exam_attempt_id
    where sa.id=target_section_attempt and a.student_id=auth.uid()
    for update of sa;
  if current_status is null then raise exception 'Section not found'; end if;

  if current_status='in_progress' and exists(
    select 1 from public.section_attempts
    where id=target_section_attempt and now()>=expires_at
  ) then
    perform public.submit_section(target_section_attempt);
    select status into current_status from public.section_attempts
      where id=target_section_attempt;
  end if;
  return current_status;
end
$$;

revoke all on function public.reconcile_section(uuid) from public;
grant execute on function public.reconcile_section(uuid) to authenticated;

revoke all on function public.start_exam(uuid,text) from anon;
revoke all on function public.start_section(uuid,uuid) from anon;
revoke all on function public.save_answer(uuid,uuid,public.answer_option,boolean,integer) from anon;
revoke all on function public.submit_section(uuid) from anon;
revoke all on function public.reconcile_section(uuid) from anon;
revoke all on function public.move_section(uuid,integer) from anon;
revoke all on function public.move_question(uuid,integer) from anon;
revoke all on function public.delete_question(uuid) from anon;
revoke all on function public.create_section(uuid,text,public.section_type,integer) from anon;
revoke all on function public.create_question(uuid,uuid,text,text,text,text,text,public.answer_option,text) from anon;
