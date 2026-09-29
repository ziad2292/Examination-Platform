create or replace function public.delete_exam(target_exam uuid, confirmation_title text, change_reason text, operation_key uuid)
returns text[]
language plpgsql security definer set search_path=''
as $$
declare
  e public.exams;
  paths text[];
  attempt_count integer;
  answer_count integer;
  correction_count integer;
begin
  if exists(
    select 1 from public.admin_audit_events
    where actor_id=auth.uid() and action='exam.permanently_deleted' and idempotency_key=operation_key
  ) then
    select coalesce(array_agg(path order by path),array[]::text[]) into paths
      from public.storage_cleanup_jobs where exam_id=target_exam;
    return paths;
  end if;

  select * into e from public.exams where id=target_exam for update;
  if e.id is null or not public.owns_exam(target_exam) then raise exception 'Exam not found'; end if;
  if confirmation_title is distinct from 'DELETE ' || e.title then raise exception 'Exam deletion confirmation did not match'; end if;
  if e.status='published' or exists(select 1 from public.exam_attempts where exam_id=target_exam and status='in_progress') then
    raise exception 'An active exam cannot be deleted; close it first';
  end if;
  if e.status not in ('draft','closed') then raise exception 'Close the exam before permanent deletion'; end if;
  if e.status='draft' and exists(select 1 from public.exam_attempts where exam_id=target_exam) then
    raise exception 'Close the exam before permanent deletion';
  end if;

  perform 1 from public.exam_attempts where exam_id=target_exam order by id for update;
  perform 1 from public.section_attempts sa join public.exam_attempts a on a.id=sa.exam_attempt_id
    where a.exam_id=target_exam order by sa.id for update of sa;

  select count(*) into attempt_count from public.exam_attempts where exam_id=target_exam;
  select count(*) into answer_count from public.answers a join public.exam_attempts ea on ea.id=a.exam_attempt_id where ea.exam_id=target_exam;
  select count(*) into correction_count from public.answer_key_corrections where exam_id=target_exam;
  select coalesce(array_agg(path order by path),array[]::text[]) into paths from (
    select q.image_path as path from public.questions q join public.exam_sections s on s.id=q.section_id
      where s.exam_id=target_exam and q.image_path is not null
    union
    select j.path from public.storage_cleanup_jobs j where j.exam_id=target_exam
  ) queued_paths;

  delete from public.admin_audit_events where exam_id=target_exam;
  delete from public.exam_retake_grants where exam_id=target_exam;
  delete from public.answer_key_corrections where exam_id=target_exam;
  delete from public.exam_duplication_jobs where target_exam_id=target_exam;
  delete from public.exam_attempts where exam_id=target_exam;

  insert into public.storage_cleanup_jobs(path,created_by,exam_id,reason)
    select unnest(paths),auth.uid(),target_exam,'permanent_exam_delete'
    on conflict(path) do update set exam_id=excluded.exam_id,reason=excluded.reason;

  delete from public.exams where id=target_exam;
  insert into public.admin_audit_events(actor_id,action,target_type,target_id,exam_id,reason,before_state,after_state,idempotency_key)
    values(auth.uid(),'exam.permanently_deleted','exam',target_exam,null,nullif(trim(change_reason),''),
      jsonb_build_object('title',e.title,'status',e.status,'scheduledStartAt',e.scheduled_start_at,'scheduledEndAt',e.scheduled_end_at,
        'attemptsRemoved',attempt_count,'answersRemoved',answer_count,'correctionsRemoved',correction_count),
      jsonb_build_object('deleted',true,'storageCleanupCount',cardinality(paths)),operation_key);
  return paths;
end
$$;
