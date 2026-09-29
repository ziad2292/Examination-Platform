create or replace function public.reschedule_exam(
  target_exam uuid,
  new_start timestamptz,
  new_end timestamptz,
  reopen boolean,
  expected_updated_at timestamptz,
  change_reason text,
  operation_key uuid
) returns public.exams
language plpgsql security definer set search_path=''
as $$
declare e public.exams; result public.exams; has_attempts boolean; before_value jsonb; effective_start timestamptz;
begin
  select * into e from public.exams where id = target_exam for update;
  if e.id is null or not public.owns_exam(target_exam) then raise exception 'Exam not found'; end if;
  if e.status = 'archived' then raise exception 'Restore the archived exam before rescheduling'; end if;
  if e.updated_at is distinct from expected_updated_at then raise exception 'Exam changed in another session'; end if;
  select exists(select 1 from public.exam_attempts where exam_id = target_exam) into has_attempts;
  effective_start := case when has_attempts then e.scheduled_start_at else new_start end;
  if new_end <= effective_start then raise exception 'Closing time must be after opening time'; end if;
  if has_attempts then
    if abs(extract(epoch from (new_start - e.scheduled_start_at))) >= 60 then
      raise exception 'Opening time is locked after attempts exist';
    end if;
    if new_end < e.scheduled_end_at then raise exception 'Closing time cannot be shortened after attempts exist'; end if;
    if new_end <= now() then raise exception 'Extended closing time must be in the future'; end if;
  end if;
  if reopen and e.status <> 'closed' then raise exception 'Only a closed exam can be reopened'; end if;
  before_value := jsonb_build_object('status',e.status,'scheduledStartAt',e.scheduled_start_at,'scheduledEndAt',e.scheduled_end_at);
  update public.exams set scheduled_start_at = effective_start, scheduled_end_at = new_end,
    status = case when reopen then 'published'::public.exam_status else status end
    where id = target_exam returning * into result;
  insert into public.admin_audit_events(actor_id,action,target_type,target_id,exam_id,reason,before_state,after_state,idempotency_key)
    values(auth.uid(),case when reopen then 'exam.reopened' else 'exam.rescheduled' end,'exam',target_exam,target_exam,
      nullif(trim(change_reason),''),before_value,
      jsonb_build_object('status',result.status,'scheduledStartAt',result.scheduled_start_at,'scheduledEndAt',result.scheduled_end_at),operation_key);
  return result;
end
$$;

-- A one-character or numeric-only section label is valid content. Keep validation
-- focused on safety and storage limits instead of imposing a naming convention.
create or replace function public.create_section(
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
  if length(trim(new_title)) not between 1 and 120 then
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

create or replace function public.publish_exam(target_exam uuid, operation_key uuid)
returns jsonb
language plpgsql security definer set search_path=''
as $$
declare e public.exams; validation jsonb; audit_action text;
begin
  select * into e from public.exams where id = target_exam for update;
  if e.id is null or not public.owns_exam(target_exam) then raise exception 'Exam not found'; end if;
  if e.status = 'published' then return public.exam_publish_validation(target_exam); end if;
  if e.status not in ('draft','closed') then raise exception 'Only draft or closed exams can be published'; end if;
  if e.status = 'draft' and exists(select 1 from public.exam_attempts where exam_id = target_exam) then
    raise exception 'A draft with attempts cannot be published';
  end if;
  validation := public.exam_publish_validation(target_exam);
  if not (validation->>'ready')::boolean then raise exception 'Exam is not ready to publish: %', validation->'errors'; end if;
  audit_action := case when e.status = 'closed' then 'exam.reopened' else 'exam.published' end;
  update public.exams set status = 'published', published_at = coalesce(published_at,now()) where id = target_exam;
  insert into public.admin_audit_events(actor_id,action,target_type,target_id,exam_id,before_state,after_state,idempotency_key)
    values(auth.uid(),audit_action,'exam',target_exam,target_exam,jsonb_build_object('status',e.status),jsonb_build_object('status','published'),operation_key)
    on conflict do nothing;
  return validation;
end
$$;

create or replace function public.delete_exam(target_exam uuid, confirmation_title text, change_reason text, operation_key uuid)
returns text[]
language plpgsql security definer set search_path=''
as $$
declare e public.exams; paths text[];
begin
  select * into e from public.exams where id = target_exam for update;
  if e.id is null or not public.owns_exam(target_exam) then raise exception 'Exam not found'; end if;
  if e.title is distinct from confirmation_title then raise exception 'Exam title confirmation did not match'; end if;
  if exists(select 1 from public.exam_attempts where exam_id = target_exam) then
    raise exception 'Exams with attempts must be archived, not deleted';
  end if;
  if e.status = 'published' and now() >= e.scheduled_start_at and now() < e.scheduled_end_at then
    raise exception 'An active exam cannot be deleted';
  end if;
  select coalesce(array_agg(q.image_path) filter(where q.image_path is not null), array[]::text[])
    into paths from public.questions q join public.exam_sections s on s.id = q.section_id
    where s.exam_id = target_exam;
  insert into public.storage_cleanup_jobs(path,created_by,exam_id,reason)
    select unnest(paths),auth.uid(),target_exam,'exam_deleted' on conflict(path) do nothing;
  delete from public.exams where id = target_exam;
  insert into public.admin_audit_events(actor_id,action,target_type,target_id,exam_id,reason,before_state,after_state,idempotency_key)
    values(auth.uid(),'exam.deleted','exam',target_exam,null,nullif(trim(change_reason),''),
      jsonb_build_object('title',e.title,'status',e.status,'scheduledStartAt',e.scheduled_start_at,'scheduledEndAt',e.scheduled_end_at),
      jsonb_build_object('storageCleanupCount',cardinality(paths)),operation_key);
  return paths;
end
$$;

create or replace function public.start_exam(target_exam uuid,target_code text default null)
returns public.exam_attempts
language plpgsql security definer set search_path=''
as $$
declare e public.exams; current_attempt public.exam_attempts; result public.exam_attempts; grant_row public.exam_retake_grants; next_generation integer;
begin
  select * into e from public.exams where id = target_exam for update;
  if e.id is null then raise exception 'Exam not found'; end if;
  if exists(select 1 from public.profiles where id = auth.uid() and not is_active) then
    raise exception 'Account is inactive';
  end if;
  if not exists(select 1 from public.profiles where id = auth.uid() and role = 'student' and is_active) then
    raise exception 'Student account required';
  end if;
  if e.status = 'closed' or now() >= e.scheduled_end_at then raise exception 'Exam is closed'; end if;
  if e.status <> 'published' then raise exception 'Exam is not available'; end if;
  if now() < e.scheduled_start_at then raise exception 'Exam has not started'; end if;
  if e.access_code_required and not exists(
    select 1 from public.exam_access_codes c where c.exam_id = e.id and c.access_code = target_code
  ) then raise exception 'Invalid access code'; end if;
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
  if grant_row.id is null then raise exception 'Retake authorization required'; end if;
  next_generation := current_attempt.generation + 1;
  insert into public.exam_attempts(exam_id,student_id,generation)
    values(target_exam,auth.uid(),next_generation) returning * into result;
  update public.exam_attempts set superseded_at = now(),superseded_by = result.id where id = current_attempt.id;
  update public.exam_retake_grants set consumed_at = now(),consumed_by_attempt_id = result.id where id = grant_row.id;
  return result;
end
$$;
