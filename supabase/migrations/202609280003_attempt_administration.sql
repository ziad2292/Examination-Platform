alter table public.exam_attempts
  drop constraint exam_attempts_exam_id_student_id_key,
  add column generation integer not null default 1 check (generation > 0),
  add column superseded_at timestamptz,
  add column superseded_by uuid;

alter table public.exam_attempts
  add constraint exam_attempts_superseded_by_fkey
    foreign key (superseded_by) references public.exam_attempts(id),
  add constraint exam_attempts_exam_student_generation_key
    unique(exam_id,student_id,generation),
  add constraint exam_attempts_supersession_consistency
    check ((superseded_at is null) = (superseded_by is null));

create index exam_attempts_exam_status_idx on public.exam_attempts(exam_id,status,last_seen_at desc);

create table public.exam_retake_grants (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams(id),
  student_id uuid not null references public.profiles(id),
  source_attempt_id uuid not null references public.exam_attempts(id),
  authorized_by uuid not null references public.profiles(id),
  reason text not null check (length(trim(reason)) between 3 and 1000),
  operation_key uuid not null,
  created_at timestamptz not null default now(),
  consumed_at timestamptz,
  consumed_by_attempt_id uuid references public.exam_attempts(id),
  unique(authorized_by,operation_key)
);

create unique index exam_retake_one_open_grant
  on public.exam_retake_grants(exam_id,student_id)
  where consumed_at is null;

create table public.answer_key_corrections (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams(id),
  question_id uuid not null references public.questions(id),
  previous_option public.answer_option not null,
  corrected_option public.answer_option not null,
  reason text not null check (length(trim(reason)) between 3 and 1000),
  corrected_by uuid not null references public.profiles(id),
  operation_key uuid not null,
  affected_attempts integer not null default 0 check (affected_attempts >= 0),
  created_at timestamptz not null default now(),
  unique(corrected_by,operation_key)
);

alter table public.exam_retake_grants enable row level security;
alter table public.answer_key_corrections enable row level security;

create policy retake_grants_teacher_read on public.exam_retake_grants for select to authenticated
using(public.owns_exam(exam_id));
create policy retake_grants_student_read on public.exam_retake_grants for select to authenticated
using(student_id = auth.uid());
create policy key_corrections_teacher_read on public.answer_key_corrections for select to authenticated
using(public.owns_exam(exam_id));

create or replace function public.guard_started_exam() returns trigger
language plpgsql set search_path=''
as $$
declare target_exam uuid; target_parent uuid;
begin
  if tg_table_name = 'exam_sections' then
    if tg_op = 'DELETE' then target_exam := old.exam_id; else target_exam := new.exam_id; end if;
  elsif tg_table_name = 'questions' then
    if tg_op = 'DELETE' then target_parent := old.section_id; else target_parent := new.section_id; end if;
    select exam_id into target_exam from public.exam_sections where id = target_parent;
  elsif tg_table_name = 'question_keys' then
    if tg_op = 'DELETE' then target_parent := old.question_id; else target_parent := new.question_id; end if;
    select s.exam_id into target_exam
      from public.questions q join public.exam_sections s on s.id = q.section_id
      where q.id = target_parent;
    if tg_op = 'UPDATE'
      and current_setting('app.answer_key_correction',true) = target_parent::text
    then
      return new;
    end if;
  end if;
  if exists(select 1 from public.exam_attempts where exam_id = target_exam) then
    raise exception 'Exam content is locked after the first attempt';
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end
$$;

create function public.recalculate_attempt_score(target_attempt uuid)
returns void
language plpgsql security definer set search_path=''
as $$
declare score integer; total integer;
begin
  insert into public.answer_results(answer_id,is_correct)
    select ans.id,ans.selected_option = k.correct_option
    from public.answers ans join public.question_keys k on k.question_id = ans.question_id
    where ans.exam_attempt_id = target_attempt
    on conflict(answer_id) do update set is_correct = excluded.is_correct,graded_at = now();

  select count(*) filter(where r.is_correct),count(q.id) into score,total
    from public.exam_attempts a
    join public.exam_sections s on s.exam_id = a.exam_id
    join public.questions q on q.section_id = s.id
    left join public.answers ans on ans.question_id = q.id and ans.exam_attempt_id = a.id
    left join public.answer_results r on r.answer_id = ans.id
    where a.id = target_attempt;
  update public.exam_attempts set raw_score = score,total_questions = total where id = target_attempt;
end
$$;

create function public.finish_section_internal(target_section_attempt uuid, forced boolean default false)
returns uuid
language plpgsql security definer set search_path=''
as $$
declare attempt_id uuid; remaining integer; attempt_status public.attempt_status;
begin
  select exam_attempt_id into attempt_id from public.section_attempts where id = target_section_attempt;
  if attempt_id is null then raise exception 'Section not found'; end if;
  perform 1 from public.exam_attempts where id = attempt_id for update;
  select status into attempt_status from public.exam_attempts where id = attempt_id;
  perform 1 from public.section_attempts where id = target_section_attempt for update;
  if attempt_status <> 'in_progress' then return attempt_id; end if;
  update public.section_attempts
    set status = case when not forced and now() >= expires_at then 'expired'::public.section_attempt_status
      else 'submitted'::public.section_attempt_status end,
      submitted_at = coalesce(submitted_at,now())
    where id = target_section_attempt and status = 'in_progress';

  select count(*) into remaining
    from public.exam_sections s
    join public.exam_attempts a on a.exam_id = s.exam_id
    where a.id = attempt_id and not exists(
      select 1 from public.section_attempts sa
      where sa.exam_attempt_id = attempt_id and sa.section_id = s.id
        and sa.status in ('submitted','expired')
    );
  if remaining = 0 then
    perform public.recalculate_attempt_score(attempt_id);
    update public.exam_attempts set status = 'completed',completed_at = coalesce(completed_at,now())
      where id = attempt_id and status = 'in_progress';
  end if;
  return attempt_id;
end
$$;

create or replace function public.submit_section(target_section_attempt uuid) returns void
language plpgsql security definer set search_path=''
as $$
declare attempt_id uuid; owner_id uuid;
begin
  select sa.exam_attempt_id,a.student_id into attempt_id,owner_id
    from public.section_attempts sa join public.exam_attempts a on a.id = sa.exam_attempt_id
    where sa.id = target_section_attempt;
  if attempt_id is null or owner_id <> auth.uid() then raise exception 'Attempt not found'; end if;
  perform public.finish_section_internal(target_section_attempt,false);
end
$$;

create or replace function public.save_answer(
  target_section_attempt uuid,
  target_question uuid,
  new_option public.answer_option,
  is_marked boolean,
  revision integer
) returns public.answers
language plpgsql security definer set search_path=''
as $$
declare attempt_id uuid; sa public.section_attempts; a public.exam_attempts; result public.answers;
begin
  select exam_attempt_id into attempt_id from public.section_attempts where id = target_section_attempt;
  select * into a from public.exam_attempts where id = attempt_id for update;
  select * into sa from public.section_attempts where id = target_section_attempt for update;
  if a.id is null or a.student_id <> auth.uid() or a.status <> 'in_progress'
    or sa.status <> 'in_progress' or now() >= sa.expires_at
  then
    raise exception 'Section is closed';
  end if;
  if not exists(select 1 from public.questions q where q.id = target_question and q.section_id = sa.section_id) then
    raise exception 'Question is outside this section';
  end if;
  insert into public.answers(exam_attempt_id,section_attempt_id,question_id,selected_option,marked_for_review,client_revision,answered_at)
    values(a.id,sa.id,target_question,new_option,is_marked,revision,case when new_option is null then null else now() end)
    on conflict(exam_attempt_id,question_id) do update set
      selected_option = excluded.selected_option,marked_for_review = excluded.marked_for_review,
      client_revision = excluded.client_revision,answered_at = excluded.answered_at,updated_at = now()
      where public.answers.client_revision <= excluded.client_revision
    returning * into result;
  update public.exam_attempts set last_seen_at = now() where id = a.id;
  return result;
end
$$;

create or replace function public.start_exam(target_exam uuid,target_code text default null)
returns public.exam_attempts
language plpgsql security definer set search_path=''
as $$
declare e public.exams; current_attempt public.exam_attempts; result public.exam_attempts; grant_row public.exam_retake_grants; next_generation integer;
begin
  select * into e from public.exams where id = target_exam for update;
  if e.id is null or e.status <> 'published' or now() < e.scheduled_start_at or now() >= e.scheduled_end_at then
    raise exception 'Exam is not currently available';
  end if;
  if e.access_code_required and not exists(
    select 1 from public.exam_access_codes c where c.exam_id = e.id and c.access_code = target_code
  ) then raise exception 'Invalid access code'; end if;
  if not exists(select 1 from public.profiles where id = auth.uid() and role = 'student') then
    raise exception 'Student account required';
  end if;
  select * into current_attempt from public.exam_attempts
    where exam_id = target_exam and student_id = auth.uid()
    order by generation desc limit 1 for update;
  if current_attempt.id is null then
    insert into public.exam_attempts(exam_id,student_id,generation)
      values(target_exam,auth.uid(),1) returning * into result;
    return result;
  end if;
  if current_attempt.status = 'in_progress' then
    update public.exam_attempts set last_seen_at = now() where id = current_attempt.id returning * into result;
    return result;
  end if;
  select * into grant_row from public.exam_retake_grants
    where exam_id = target_exam and student_id = auth.uid() and consumed_at is null
    order by created_at limit 1 for update;
  if grant_row.id is null then return current_attempt; end if;
  next_generation := current_attempt.generation + 1;
  insert into public.exam_attempts(exam_id,student_id,generation)
    values(target_exam,auth.uid(),next_generation) returning * into result;
  update public.exam_attempts set superseded_at = now(),superseded_by = result.id
    where id = current_attempt.id;
  update public.exam_retake_grants set consumed_at = now(),consumed_by_attempt_id = result.id
    where id = grant_row.id;
  return result;
end
$$;

create function public.authorize_attempt_retake(
  target_attempt uuid,
  change_reason text,
  operation_key uuid
) returns uuid
language plpgsql security definer set search_path=''
as $$
declare a public.exam_attempts; grant_id uuid;
begin
  select id into grant_id from public.exam_retake_grants
    where authorized_by = auth.uid() and exam_retake_grants.operation_key = authorize_attempt_retake.operation_key;
  if grant_id is not null then return grant_id; end if;
  select * into a from public.exam_attempts where id = target_attempt for update;
  if a.id is null or not public.owns_exam(a.exam_id) then raise exception 'Attempt not found'; end if;
  select id into grant_id from public.exam_retake_grants
    where authorized_by = auth.uid() and exam_retake_grants.operation_key = authorize_attempt_retake.operation_key;
  if grant_id is not null then return grant_id; end if;
  if a.status = 'in_progress' then raise exception 'Use reset for an active attempt'; end if;
  if length(trim(change_reason)) < 3 then raise exception 'A reason is required'; end if;
  insert into public.exam_retake_grants(exam_id,student_id,source_attempt_id,authorized_by,reason,operation_key)
    values(a.exam_id,a.student_id,a.id,auth.uid(),trim(change_reason),operation_key)
    on conflict(exam_id,student_id) where consumed_at is null do update set
      source_attempt_id = excluded.source_attempt_id,authorized_by = excluded.authorized_by,
      reason = excluded.reason,operation_key = excluded.operation_key,created_at = now()
    returning id into grant_id;
  insert into public.admin_audit_events(actor_id,action,target_type,target_id,exam_id,reason,after_state,idempotency_key)
    values(auth.uid(),'attempt.retake_authorized','attempt',a.id,a.exam_id,trim(change_reason),
      jsonb_build_object('grantId',grant_id,'studentId',a.student_id),operation_key);
  return grant_id;
end
$$;

create function public.reset_attempt(
  target_attempt uuid,
  change_reason text,
  operation_key uuid
) returns uuid
language plpgsql security definer set search_path=''
as $$
declare a public.exam_attempts; grant_id uuid;
begin
  select id into grant_id from public.exam_retake_grants
    where authorized_by = auth.uid() and exam_retake_grants.operation_key = reset_attempt.operation_key;
  if grant_id is not null then return grant_id; end if;
  select * into a from public.exam_attempts where id = target_attempt for update;
  if a.id is null or not public.owns_exam(a.exam_id) then raise exception 'Attempt not found'; end if;
  select id into grant_id from public.exam_retake_grants
    where authorized_by = auth.uid() and exam_retake_grants.operation_key = reset_attempt.operation_key;
  if grant_id is not null then return grant_id; end if;
  if length(trim(change_reason)) < 3 then raise exception 'A reason is required'; end if;
  if a.status = 'in_progress' then
    update public.section_attempts set status = 'submitted',submitted_at = coalesce(submitted_at,now())
      where exam_attempt_id = a.id and status = 'in_progress';
    update public.exam_attempts set status = 'expired',completed_at = now() where id = a.id;
    perform public.recalculate_attempt_score(a.id);
  end if;
  insert into public.exam_retake_grants(exam_id,student_id,source_attempt_id,authorized_by,reason,operation_key)
    values(a.exam_id,a.student_id,a.id,auth.uid(),trim(change_reason),operation_key)
    on conflict(exam_id,student_id) where consumed_at is null do update set
      source_attempt_id = excluded.source_attempt_id,authorized_by = excluded.authorized_by,
      reason = excluded.reason,operation_key = excluded.operation_key,created_at = now()
    returning id into grant_id;
  insert into public.admin_audit_events(actor_id,action,target_type,target_id,exam_id,reason,before_state,after_state,idempotency_key)
    values(auth.uid(),'attempt.reset','attempt',a.id,a.exam_id,trim(change_reason),
      jsonb_build_object('status',a.status,'generation',a.generation),
      jsonb_build_object('status',case when a.status = 'in_progress' then 'expired' else a.status::text end,'retakeGrantId',grant_id),operation_key);
  return grant_id;
end
$$;

create function public.teacher_submit_section(
  target_section_attempt uuid,
  change_reason text,
  operation_key uuid
) returns uuid
language plpgsql security definer set search_path=''
as $$
declare attempt_id uuid; exam_id uuid; before_status text;
begin
  select sa.exam_attempt_id,a.exam_id,sa.status::text into attempt_id,exam_id,before_status
    from public.section_attempts sa join public.exam_attempts a on a.id = sa.exam_attempt_id
    where sa.id = target_section_attempt;
  if attempt_id is null or not public.owns_exam(exam_id) then raise exception 'Section attempt not found'; end if;
  perform 1 from public.exam_attempts where id = attempt_id for update;
  if exists(select 1 from public.admin_audit_events where actor_id = auth.uid() and action = 'attempt.section_submitted' and idempotency_key = operation_key) then
    return attempt_id;
  end if;
  perform public.finish_section_internal(target_section_attempt,true);
  insert into public.admin_audit_events(actor_id,action,target_type,target_id,exam_id,reason,before_state,after_state,idempotency_key)
    values(auth.uid(),'attempt.section_submitted','section_attempt',target_section_attempt,exam_id,nullif(trim(change_reason),''),
      jsonb_build_object('status',before_status),jsonb_build_object('status',(select status from public.section_attempts where id = target_section_attempt)),operation_key);
  return attempt_id;
end
$$;

create function public.teacher_submit_attempt(
  target_attempt uuid,
  change_reason text,
  operation_key uuid
) returns uuid
language plpgsql security definer set search_path=''
as $$
declare a public.exam_attempts;
begin
  select * into a from public.exam_attempts where id = target_attempt for update;
  if a.id is null or not public.owns_exam(a.exam_id) then raise exception 'Attempt not found'; end if;
  if exists(select 1 from public.admin_audit_events where actor_id = auth.uid() and action = 'attempt.manually_submitted' and idempotency_key = operation_key) then
    return a.id;
  end if;
  if a.status = 'in_progress' then
    update public.section_attempts set status = 'submitted',submitted_at = coalesce(submitted_at,now())
      where exam_attempt_id = a.id and status = 'in_progress';
    perform public.recalculate_attempt_score(a.id);
    update public.exam_attempts set status = 'completed',completed_at = now() where id = a.id;
  end if;
  insert into public.admin_audit_events(actor_id,action,target_type,target_id,exam_id,reason,before_state,after_state,idempotency_key)
    values(auth.uid(),'attempt.manually_submitted','attempt',a.id,a.exam_id,nullif(trim(change_reason),''),
      jsonb_build_object('status',a.status),jsonb_build_object('status',(select status from public.exam_attempts where id = a.id)),operation_key);
  return a.id;
end
$$;

create function public.correct_answer_key(
  target_question uuid,
  corrected public.answer_option,
  change_reason text,
  operation_key uuid
) returns uuid
language plpgsql security definer set search_path=''
as $$
declare owned_exam_id uuid; previous public.answer_option; correction_id uuid; affected integer := 0; attempt_row record;
begin
  select id into correction_id from public.answer_key_corrections
    where corrected_by = auth.uid() and answer_key_corrections.operation_key = correct_answer_key.operation_key;
  if correction_id is not null then return correction_id; end if;
  select s.exam_id,k.correct_option into owned_exam_id,previous
    from public.questions q
    join public.exam_sections s on s.id = q.section_id
    join public.question_keys k on k.question_id = q.id
    where q.id = target_question for update of k;
  if owned_exam_id is null or not public.owns_exam(owned_exam_id) then raise exception 'Question not found'; end if;
  perform 1 from public.exams where id = owned_exam_id for update;
  select id into correction_id from public.answer_key_corrections
    where corrected_by = auth.uid() and answer_key_corrections.operation_key = correct_answer_key.operation_key;
  if correction_id is not null then return correction_id; end if;
  if length(trim(change_reason)) < 3 then raise exception 'A correction reason is required'; end if;
  if previous = corrected then raise exception 'Corrected option must be different'; end if;
  perform set_config('app.answer_key_correction',target_question::text,true);
  update public.question_keys set correct_option = corrected where question_id = target_question;
  for attempt_row in select id from public.exam_attempts where exam_id = owned_exam_id and status in ('completed','expired') for update
  loop
    perform public.recalculate_attempt_score(attempt_row.id);
    affected := affected + 1;
  end loop;
  insert into public.answer_key_corrections(exam_id,question_id,previous_option,corrected_option,reason,corrected_by,operation_key,affected_attempts)
    values(owned_exam_id,target_question,previous,corrected,trim(change_reason),auth.uid(),operation_key,affected)
    returning id into correction_id;
  insert into public.admin_audit_events(actor_id,action,target_type,target_id,exam_id,reason,before_state,after_state,idempotency_key)
    values(auth.uid(),'question.answer_key_corrected','question',target_question,owned_exam_id,trim(change_reason),
      jsonb_build_object('correctOption',previous),jsonb_build_object('correctOption',corrected,'regradedAttempts',affected),operation_key);
  return correction_id;
end
$$;

revoke all on function public.recalculate_attempt_score(uuid) from public,anon,authenticated;
revoke all on function public.finish_section_internal(uuid,boolean) from public,anon,authenticated;
revoke all on function public.authorize_attempt_retake(uuid,text,uuid) from public,anon;
revoke all on function public.reset_attempt(uuid,text,uuid) from public,anon;
revoke all on function public.teacher_submit_section(uuid,text,uuid) from public,anon;
revoke all on function public.teacher_submit_attempt(uuid,text,uuid) from public,anon;
revoke all on function public.correct_answer_key(uuid,public.answer_option,text,uuid) from public,anon;

grant execute on function public.authorize_attempt_retake(uuid,text,uuid) to authenticated;
grant execute on function public.reset_attempt(uuid,text,uuid) to authenticated;
grant execute on function public.teacher_submit_section(uuid,text,uuid) to authenticated;
grant execute on function public.teacher_submit_attempt(uuid,text,uuid) to authenticated;
grant execute on function public.correct_answer_key(uuid,public.answer_option,text,uuid) to authenticated;
