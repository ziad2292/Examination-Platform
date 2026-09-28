alter table public.exams
  add column instructions text,
  add constraint exams_instructions_length check (instructions is null or length(instructions) <= 10000);

create table public.admin_audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.profiles(id),
  action text not null check (length(action) between 3 and 80),
  target_type text not null check (length(target_type) between 3 and 40),
  target_id uuid not null,
  exam_id uuid,
  reason text check (reason is null or length(reason) between 3 and 1000),
  before_state jsonb,
  after_state jsonb,
  idempotency_key uuid,
  created_at timestamptz not null default now()
);

create unique index admin_audit_idempotency_unique
  on public.admin_audit_events(actor_id, action, idempotency_key)
  where idempotency_key is not null;
create index admin_audit_exam_created_idx
  on public.admin_audit_events(exam_id, created_at desc);

create table public.storage_cleanup_jobs (
  path text primary key,
  created_by uuid not null references public.profiles(id),
  exam_id uuid,
  reason text not null,
  created_at timestamptz not null default now()
);

create table public.exam_duplication_jobs (
  target_exam_id uuid primary key,
  source_exam_id uuid not null references public.exams(id) on delete cascade,
  created_by uuid not null references public.profiles(id),
  operation_key uuid not null,
  status text not null default 'pending' check (status in ('pending','completed')),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(created_by, operation_key)
);

alter table public.admin_audit_events enable row level security;
alter table public.storage_cleanup_jobs enable row level security;
alter table public.exam_duplication_jobs enable row level security;

create policy admin_audit_teacher_read on public.admin_audit_events for select to authenticated
using(public.is_teacher() and (actor_id = auth.uid() or public.owns_exam(exam_id)));
create policy cleanup_jobs_owner_read on public.storage_cleanup_jobs for select to authenticated
using(created_by = auth.uid() and public.is_teacher());
create policy duplication_jobs_owner_read on public.exam_duplication_jobs for select to authenticated
using(created_by = auth.uid() and public.is_teacher());

drop policy if exists exams_teacher_all on public.exams;
create policy exams_teacher_read on public.exams for select to authenticated
using(public.is_teacher() and created_by = auth.uid());
create policy exams_teacher_insert on public.exams for insert to authenticated
with check(public.is_teacher() and created_by = auth.uid());

create or replace function public.exam_publish_validation(target_exam uuid)
returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  e public.exams;
  errors jsonb := '[]'::jsonb;
  module_count integer;
  break_count integer;
  question_count integer;
  key_count integer;
  section_count integer;
begin
  select * into e from public.exams where id = target_exam;
  if e.id is null or (auth.uid() is not null and not public.owns_exam(target_exam)) then
    raise exception 'Exam not found';
  end if;

  select count(*) filter(where section_type = 'module'),
         count(*) filter(where section_type = 'break'),
         count(*)
    into module_count, break_count, section_count
    from public.exam_sections where exam_id = target_exam;
  select count(*) into question_count
    from public.questions q join public.exam_sections s on s.id = q.section_id
    where s.exam_id = target_exam;
  select count(*) into key_count
    from public.question_keys k
    join public.questions q on q.id = k.question_id
    join public.exam_sections s on s.id = q.section_id
    where s.exam_id = target_exam;

  if length(trim(e.title)) < 3 then
    errors := errors || jsonb_build_array('Exam title must contain at least 3 characters.');
  end if;
  if e.scheduled_end_at <= e.scheduled_start_at then
    errors := errors || jsonb_build_array('Exam closing time must be after opening time.');
  end if;
  if e.scheduled_end_at <= now() then
    errors := errors || jsonb_build_array('Exam closing time must be in the future.');
  end if;
  if module_count = 0 then
    errors := errors || jsonb_build_array('Add at least one module.');
  end if;
  if exists(
    select 1 from public.exam_sections s
    where s.exam_id = target_exam and s.section_type = 'module'
      and not exists(select 1 from public.questions q where q.section_id = s.id)
  ) then
    errors := errors || jsonb_build_array('Every module must contain at least one question.');
  end if;
  if section_count > 0 and exists(
    select 1 from (
      select min(section_order) minimum, max(section_order) maximum,
             count(*) total, count(distinct section_order) distinct_total
      from public.exam_sections where exam_id = target_exam
    ) ordered where minimum <> 1 or maximum <> total or distinct_total <> total
  ) then
    errors := errors || jsonb_build_array('Section order must be contiguous and unique.');
  end if;
  if exists(
    select 1 from public.exam_sections current_section
    left join public.exam_sections previous_section
      on previous_section.exam_id = current_section.exam_id
      and previous_section.section_order = current_section.section_order - 1
    where current_section.exam_id = target_exam
      and current_section.section_type = 'break'
      and (
        current_section.section_order = 1
        or current_section.section_order = section_count
        or previous_section.section_type = 'break'
      )
  ) then
    errors := errors || jsonb_build_array('Breaks must appear between modules and cannot be consecutive.');
  end if;
  if exists(
    select 1 from public.exam_sections s
    where s.exam_id = target_exam and s.duration_seconds not between 60 and 14400
  ) then
    errors := errors || jsonb_build_array('Every section needs a valid duration.');
  end if;
  if exists(
    select 1 from public.questions q
    join public.exam_sections s on s.id = q.section_id
    where s.exam_id = target_exam
      and coalesce(nullif(trim(q.optional_text),''), q.image_path) is null
  ) then
    errors := errors || jsonb_build_array('Every question needs text or an image.');
  end if;
  if exists(
    select 1 from public.questions q
    join public.exam_sections s on s.id = q.section_id
    where s.exam_id = target_exam
      and not exists(select 1 from public.question_keys k where k.question_id = q.id)
  ) then
    errors := errors || jsonb_build_array('Every question needs an answer key.');
  end if;
  if exists(
    select 1 from public.questions q
    join public.exam_sections s on s.id = q.section_id
    where s.exam_id = target_exam and q.image_path is not null
      and not exists(
        select 1 from storage.objects o
        where o.bucket_id = 'question-images' and o.name = q.image_path
      )
  ) then
    errors := errors || jsonb_build_array('One or more question images are missing from Storage.');
  end if;
  if exists(
    select 1 from public.exam_sections s
    where s.exam_id = target_exam and exists(
      select 1 from (
        select min(q.question_order) minimum, max(q.question_order) maximum,
               count(*) total, count(distinct q.question_order) distinct_total
        from public.questions q where q.section_id = s.id
      ) ordered
      where total > 0 and (minimum <> 1 or maximum <> total or distinct_total <> total)
    )
  ) then
    errors := errors || jsonb_build_array('Question order must be contiguous and unique in every module.');
  end if;
  if e.access_code_required and not exists(
    select 1 from public.exam_access_codes where exam_id = target_exam
  ) then
    errors := errors || jsonb_build_array('Configure the required access code.');
  end if;

  return jsonb_build_object(
    'ready', jsonb_array_length(errors) = 0,
    'errors', errors,
    'modules', module_count,
    'breaks', break_count,
    'questions', question_count,
    'answerKeys', key_count,
    'scheduleValid', e.scheduled_end_at > e.scheduled_start_at and e.scheduled_end_at > now()
  );
end
$$;

create function public.teacher_exam_attempt_counts(target_exams uuid[])
returns table(exam_id uuid,total_attempts bigint,active_attempts bigint)
language sql stable security definer set search_path=''
as $$
  select e.id,count(a.id),count(a.id) filter(where a.status = 'in_progress')
  from public.exams e left join public.exam_attempts a on a.exam_id = e.id
  where e.created_by = auth.uid() and e.id = any(target_exams)
  group by e.id
$$;

create or replace function public.guard_exam_update() returns trigger
language plpgsql set search_path=''
as $$
declare validation jsonb;
begin
  if exists(select 1 from public.exam_attempts where exam_id = old.id) then
    if new.access_code_required is distinct from old.access_code_required then
      raise exception 'Access-code configuration is locked after the first attempt';
    end if;
    if new.scheduled_start_at is distinct from old.scheduled_start_at then
      raise exception 'Opening time is locked after the first attempt';
    end if;
    if new.scheduled_end_at < old.scheduled_end_at then
      raise exception 'Closing time cannot be shortened after the first attempt';
    end if;
  end if;

  if old.status = 'archived' and new.status = 'archived'
    and row(new.title,new.description,new.instructions,new.access_code_required,
            new.scheduled_start_at,new.scheduled_end_at)
      is distinct from
        row(old.title,old.description,old.instructions,old.access_code_required,
            old.scheduled_start_at,old.scheduled_end_at)
  then
    raise exception 'Archived exams are read-only';
  end if;

  if new.status is distinct from old.status and not (
    (old.status = 'draft' and new.status in ('published','archived'))
    or (old.status = 'published' and new.status in ('closed','archived'))
    or (old.status = 'closed' and new.status in ('published','archived'))
    or (old.status = 'archived' and new.status in ('draft','closed'))
  ) then
    raise exception 'Illegal exam status transition';
  end if;

  if new.status = 'archived' and old.status <> 'archived'
    and exists(select 1 from public.exam_attempts where exam_id = old.id and status = 'in_progress')
  then
    raise exception 'Cannot archive an exam with active attempts';
  end if;

  if new.status = 'published' and old.status <> 'published' then
    validation := public.exam_publish_validation(old.id);
    if not (validation->>'ready')::boolean then
      if not exists(select 1 from public.exam_sections where exam_id = old.id) then
        raise exception 'An exam needs at least one section before publishing';
      end if;
      if exists(
        select 1 from public.exam_sections s
        where s.exam_id = old.id and s.section_type = 'module'
          and not exists(select 1 from public.questions q where q.section_id = s.id)
      ) then
        raise exception 'Every module needs at least one question';
      end if;
      if exists(
        select 1 from public.questions q
        join public.exam_sections s on s.id = q.section_id
        where s.exam_id = old.id
          and not exists(select 1 from public.question_keys k where k.question_id = q.id)
      ) then
        raise exception 'Every question needs an answer key';
      end if;
      raise exception 'Exam is not ready to publish: %', validation->'errors';
    end if;
  end if;
  return new;
end
$$;

create function public.update_exam_metadata(
  target_exam uuid,
  new_title text,
  new_description text,
  new_instructions text,
  new_start timestamptz,
  new_end timestamptz,
  expected_updated_at timestamptz,
  change_reason text,
  operation_key uuid
) returns public.exams
language plpgsql security definer set search_path=''
as $$
declare e public.exams; result public.exams; before_value jsonb;
begin
  select * into e from public.exams where id = target_exam for update;
  if e.id is null or not public.owns_exam(target_exam) then raise exception 'Exam not found'; end if;
  if e.status = 'archived' then raise exception 'Archived exams are read-only'; end if;
  if e.updated_at is distinct from expected_updated_at then raise exception 'Exam changed in another session'; end if;
  if length(trim(new_title)) not between 3 and 120 then raise exception 'Invalid exam title'; end if;
  if length(coalesce(new_description,'')) > 2000 then raise exception 'Description is too long'; end if;
  if length(coalesce(new_instructions,'')) > 10000 then raise exception 'Instructions are too long'; end if;
  if new_end <= new_start then raise exception 'Closing time must be after opening time'; end if;
  if exists(select 1 from public.exam_attempts where exam_id = target_exam)
    and (new_start is distinct from e.scheduled_start_at or new_end is distinct from e.scheduled_end_at)
  then
    raise exception 'Use the audited reschedule workflow after attempts exist';
  end if;
  before_value := jsonb_build_object('title',e.title,'description',e.description,'instructions',e.instructions,
    'scheduledStartAt',e.scheduled_start_at,'scheduledEndAt',e.scheduled_end_at);
  update public.exams set
    title = trim(new_title), description = nullif(trim(new_description),''),
    instructions = nullif(trim(new_instructions),''),
    scheduled_start_at = new_start, scheduled_end_at = new_end
    where id = target_exam returning * into result;
  insert into public.admin_audit_events(actor_id,action,target_type,target_id,exam_id,reason,before_state,after_state,idempotency_key)
    values(auth.uid(),'exam.metadata_updated','exam',target_exam,target_exam,nullif(trim(change_reason),''),before_value,
      jsonb_build_object('title',result.title,'description',result.description,'instructions',result.instructions,
        'scheduledStartAt',result.scheduled_start_at,'scheduledEndAt',result.scheduled_end_at),operation_key);
  return result;
end
$$;

create function public.reschedule_exam(
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
declare e public.exams; result public.exams; has_attempts boolean; before_value jsonb;
begin
  select * into e from public.exams where id = target_exam for update;
  if e.id is null or not public.owns_exam(target_exam) then raise exception 'Exam not found'; end if;
  if e.status = 'archived' then raise exception 'Restore the archived exam before rescheduling'; end if;
  if e.updated_at is distinct from expected_updated_at then raise exception 'Exam changed in another session'; end if;
  if new_end <= new_start then raise exception 'Closing time must be after opening time'; end if;
  select exists(select 1 from public.exam_attempts where exam_id = target_exam) into has_attempts;
  if has_attempts then
    if new_start is distinct from e.scheduled_start_at then raise exception 'Opening time is locked after attempts exist'; end if;
    if new_end < e.scheduled_end_at then raise exception 'Closing time cannot be shortened after attempts exist'; end if;
    if new_end <= now() then raise exception 'Extended closing time must be in the future'; end if;
  end if;
  if reopen and e.status not in ('closed','published') then raise exception 'Only a closed exam can be reopened'; end if;
  before_value := jsonb_build_object('status',e.status,'scheduledStartAt',e.scheduled_start_at,'scheduledEndAt',e.scheduled_end_at);
  update public.exams set scheduled_start_at = new_start, scheduled_end_at = new_end,
    status = case when reopen then 'published'::public.exam_status else status end
    where id = target_exam returning * into result;
  insert into public.admin_audit_events(actor_id,action,target_type,target_id,exam_id,reason,before_state,after_state,idempotency_key)
    values(auth.uid(),case when reopen then 'exam.reopened' else 'exam.rescheduled' end,'exam',target_exam,target_exam,
      nullif(trim(change_reason),''),before_value,
      jsonb_build_object('status',result.status,'scheduledStartAt',result.scheduled_start_at,'scheduledEndAt',result.scheduled_end_at),operation_key);
  return result;
end
$$;

create function public.publish_exam(target_exam uuid, operation_key uuid)
returns jsonb
language plpgsql security definer set search_path=''
as $$
declare e public.exams; validation jsonb;
begin
  select * into e from public.exams where id = target_exam for update;
  if e.id is null or not public.owns_exam(target_exam) then raise exception 'Exam not found'; end if;
  if e.status <> 'draft' then raise exception 'Only draft exams can be published'; end if;
  if exists(select 1 from public.exam_attempts where exam_id = target_exam) then raise exception 'Exam already has attempts'; end if;
  validation := public.exam_publish_validation(target_exam);
  if not (validation->>'ready')::boolean then raise exception 'Exam is not ready to publish: %', validation->'errors'; end if;
  update public.exams set status = 'published', published_at = now() where id = target_exam;
  insert into public.admin_audit_events(actor_id,action,target_type,target_id,exam_id,after_state,idempotency_key)
    values(auth.uid(),'exam.published','exam',target_exam,target_exam,jsonb_build_object('status','published'),operation_key);
  return validation;
end
$$;

create function public.archive_exam(target_exam uuid, change_reason text, operation_key uuid)
returns public.exams
language plpgsql security definer set search_path=''
as $$
declare e public.exams; result public.exams;
begin
  select * into e from public.exams where id = target_exam for update;
  if e.id is null or not public.owns_exam(target_exam) then raise exception 'Exam not found'; end if;
  if e.status = 'archived' then return e; end if;
  if exists(select 1 from public.exam_attempts where exam_id = target_exam and status = 'in_progress') then
    raise exception 'Cannot archive an exam with active attempts';
  end if;
  update public.exams set status = 'archived' where id = target_exam returning * into result;
  insert into public.admin_audit_events(actor_id,action,target_type,target_id,exam_id,reason,before_state,after_state,idempotency_key)
    values(auth.uid(),'exam.archived','exam',target_exam,target_exam,nullif(trim(change_reason),''),
      jsonb_build_object('status',e.status),jsonb_build_object('status','archived'),operation_key)
    on conflict do nothing;
  return result;
end
$$;

create function public.close_exam(target_exam uuid, change_reason text, operation_key uuid)
returns public.exams
language plpgsql security definer set search_path=''
as $$
declare e public.exams; result public.exams;
begin
  select * into e from public.exams where id = target_exam for update;
  if e.id is null or not public.owns_exam(target_exam) then raise exception 'Exam not found'; end if;
  if e.status = 'closed' then return e; end if;
  if e.status <> 'published' then raise exception 'Only a published exam can be closed'; end if;
  update public.exams set status = 'closed' where id = target_exam returning * into result;
  insert into public.admin_audit_events(actor_id,action,target_type,target_id,exam_id,reason,before_state,after_state,idempotency_key)
    values(auth.uid(),'exam.closed','exam',target_exam,target_exam,nullif(trim(change_reason),''),
      jsonb_build_object('status','published'),jsonb_build_object('status','closed'),operation_key)
    on conflict do nothing;
  return result;
end
$$;

create function public.restore_exam(target_exam uuid, change_reason text, operation_key uuid)
returns public.exams
language plpgsql security definer set search_path=''
as $$
declare e public.exams; result public.exams; restored_status public.exam_status;
begin
  select * into e from public.exams where id = target_exam for update;
  if e.id is null or not public.owns_exam(target_exam) then raise exception 'Exam not found'; end if;
  if e.status <> 'archived' then return e; end if;
  restored_status := case when exists(select 1 from public.exam_attempts where exam_id = target_exam)
    then 'closed'::public.exam_status else 'draft'::public.exam_status end;
  update public.exams set status = restored_status where id = target_exam returning * into result;
  insert into public.admin_audit_events(actor_id,action,target_type,target_id,exam_id,reason,before_state,after_state,idempotency_key)
    values(auth.uid(),'exam.restored','exam',target_exam,target_exam,nullif(trim(change_reason),''),
      jsonb_build_object('status','archived'),jsonb_build_object('status',restored_status),operation_key)
    on conflict do nothing;
  return result;
end
$$;

create function public.delete_exam(target_exam uuid, confirmation_title text, change_reason text, operation_key uuid)
returns text[]
language plpgsql security definer set search_path=''
as $$
declare e public.exams; paths text[];
begin
  select * into e from public.exams where id = target_exam for update;
  if e.id is null or not public.owns_exam(target_exam) then raise exception 'Exam not found'; end if;
  if e.status <> 'draft' then raise exception 'Only draft exams can be permanently deleted'; end if;
  if e.title is distinct from confirmation_title then raise exception 'Exam title confirmation did not match'; end if;
  if exists(select 1 from public.exam_attempts where exam_id = target_exam) then
    raise exception 'Exams with attempts must be archived, not deleted';
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

create function public.acknowledge_storage_cleanup(cleaned_paths text[])
returns integer
language plpgsql security definer set search_path=''
as $$
declare removed integer;
begin
  delete from public.storage_cleanup_jobs
    where created_by = auth.uid() and path = any(cleaned_paths);
  get diagnostics removed = row_count;
  return removed;
end
$$;

create function public.begin_exam_duplication(source_exam uuid, target_exam uuid, operation_key uuid)
returns uuid
language plpgsql security definer set search_path=''
as $$
declare existing uuid;
begin
  if not public.owns_exam(source_exam) then raise exception 'Exam not found'; end if;
  select j.target_exam_id into existing from public.exam_duplication_jobs j
    where j.created_by = auth.uid() and j.operation_key = $3;
  if existing is not null then return existing; end if;
  if exists(select 1 from public.exams where id = target_exam) then raise exception 'Target exam ID already exists'; end if;
  insert into public.exam_duplication_jobs(target_exam_id,source_exam_id,created_by,operation_key)
    values(target_exam,source_exam,auth.uid(),operation_key);
  return target_exam;
end
$$;

create function public.complete_exam_duplication(
  target_exam uuid,
  new_title text,
  image_map jsonb,
  operation_key uuid
) returns uuid
language plpgsql security definer set search_path=''
as $$
declare
  job public.exam_duplication_jobs;
  source public.exams;
  source_section public.exam_sections;
  source_question public.questions;
  new_section uuid;
  new_question uuid;
  mapped_path text;
begin
  select j.* into job from public.exam_duplication_jobs j
    where j.target_exam_id = $1 and j.created_by = auth.uid() and j.operation_key = $4
    for update;
  if job.target_exam_id is null then raise exception 'Duplication job not found'; end if;
  if exists(select 1 from public.exams where id = target_exam) then return target_exam; end if;
  select * into source from public.exams where id = job.source_exam_id for share;
  if source.id is null or not public.owns_exam(source.id) then raise exception 'Source exam not found'; end if;
  if length(trim(new_title)) not between 3 and 120 then raise exception 'Invalid duplicate title'; end if;

  insert into public.exams(id,title,description,instructions,access_code_required,status,scheduled_start_at,scheduled_end_at,created_by)
    values(target_exam,trim(new_title),source.description,source.instructions,false,'draft',now()+interval '1 day',now()+interval '8 days',auth.uid());

  for source_section in
    select * from public.exam_sections where exam_id = source.id order by section_order
  loop
    new_section := gen_random_uuid();
    insert into public.exam_sections(id,exam_id,title,section_type,section_order,duration_seconds)
      values(new_section,target_exam,source_section.title,source_section.section_type,source_section.section_order,source_section.duration_seconds);
    for source_question in
      select * from public.questions where section_id = source_section.id order by question_order
    loop
      mapped_path := null;
      if source_question.image_path is not null then
        mapped_path := image_map->>source_question.image_path;
        if mapped_path is null or mapped_path not like target_exam::text || '/%' then
          raise exception 'Missing duplicated image mapping';
        end if;
        if not exists(select 1 from storage.objects where bucket_id = 'question-images' and name = mapped_path) then
          raise exception 'Duplicated image is missing from Storage';
        end if;
      end if;
      new_question := gen_random_uuid();
      insert into public.questions(id,section_id,question_order,image_path,optional_text,option_a,option_b,option_c,option_d)
        values(new_question,new_section,source_question.question_order,mapped_path,source_question.optional_text,
          source_question.option_a,source_question.option_b,source_question.option_c,source_question.option_d);
      insert into public.question_keys(question_id,correct_option)
        select new_question,correct_option from public.question_keys where question_id = source_question.id;
    end loop;
  end loop;

  update public.exam_duplication_jobs set status = 'completed', completed_at = now()
    where target_exam_id = target_exam;
  insert into public.admin_audit_events(actor_id,action,target_type,target_id,exam_id,before_state,after_state,idempotency_key)
    values(auth.uid(),'exam.duplicated','exam',target_exam,target_exam,
      jsonb_build_object('sourceExamId',source.id),jsonb_build_object('status','draft'),operation_key);
  return target_exam;
end
$$;

create function public.replace_question_image(
  target_question uuid,
  expected_old_path text,
  new_path text,
  change_reason text,
  operation_key uuid
) returns text
language plpgsql security definer set search_path=''
as $$
declare q public.questions; owned_exam_id uuid; exam_status public.exam_status; old_path text; prior_new_path text;
begin
  select before_state->>'imagePath',after_state->>'imagePath' into old_path,prior_new_path
    from public.admin_audit_events
    where actor_id = auth.uid() and action = 'question.image_replaced' and idempotency_key = operation_key;
  if prior_new_path is not null then
    if prior_new_path = new_path then return old_path; end if;
    raise exception 'Replacement operation already completed';
  end if;
  select q1.* into q
    from public.questions q1 join public.exam_sections s on s.id = q1.section_id
    where q1.id = target_question for update of q1;
  select s.exam_id into owned_exam_id
    from public.exam_sections s where s.id = q.section_id;
  if q.id is null or not public.owns_exam(owned_exam_id) then raise exception 'Question not found'; end if;
  select status into exam_status from public.exams where id = owned_exam_id for update;
  if exam_status not in ('draft','published') then raise exception 'Exam is read-only'; end if;
  if exists(select 1 from public.exam_attempts where exam_id = owned_exam_id) then
    raise exception 'Question images are immutable after attempts exist';
  end if;
  if q.image_path is distinct from nullif(expected_old_path,'') then raise exception 'Question image changed in another session'; end if;
  if new_path not like owned_exam_id::text || '/%' then raise exception 'Invalid image path'; end if;
  if not exists(select 1 from storage.objects where bucket_id = 'question-images' and name = new_path) then
    raise exception 'Replacement image is missing from Storage';
  end if;
  old_path := q.image_path;
  update public.questions set image_path = new_path where id = target_question;
  if old_path is not null then
    insert into public.storage_cleanup_jobs(path,created_by,exam_id,reason)
      values(old_path,auth.uid(),owned_exam_id,'question_image_replaced') on conflict(path) do nothing;
  end if;
  insert into public.admin_audit_events(actor_id,action,target_type,target_id,exam_id,reason,before_state,after_state,idempotency_key)
    values(auth.uid(),'question.image_replaced','question',target_question,owned_exam_id,nullif(trim(change_reason),''),
      jsonb_build_object('imagePath',old_path),jsonb_build_object('imagePath',new_path),operation_key);
  return old_path;
end
$$;

drop policy if exists question_images_teacher_write on storage.objects;
drop policy if exists question_images_teacher_update on storage.objects;
drop policy if exists question_images_teacher_delete on storage.objects;

create policy question_images_teacher_write on storage.objects for insert to authenticated
with check(
  bucket_id = 'question-images' and public.is_teacher() and (
    name like 'question-import-staging/' || auth.uid()::text || '/%'
    or exists(select 1 from public.exams e where e.id::text = split_part(name,'/',1) and e.created_by = auth.uid())
    or exists(select 1 from public.exam_duplication_jobs j where j.target_exam_id::text = split_part(name,'/',1) and j.created_by = auth.uid() and j.status = 'pending')
  )
);
create policy question_images_teacher_update on storage.objects for update to authenticated
using(bucket_id = 'question-images' and public.is_teacher() and (
  name like 'question-import-staging/' || auth.uid()::text || '/%'
  or exists(select 1 from public.exams e where e.id::text = split_part(name,'/',1) and e.created_by = auth.uid())
  or exists(select 1 from public.exam_duplication_jobs j where j.target_exam_id::text = split_part(name,'/',1) and j.created_by = auth.uid() and j.status = 'pending')
))
with check(bucket_id = 'question-images' and public.is_teacher() and (
  name like 'question-import-staging/' || auth.uid()::text || '/%'
  or exists(select 1 from public.exams e where e.id::text = split_part(name,'/',1) and e.created_by = auth.uid())
  or exists(select 1 from public.exam_duplication_jobs j where j.target_exam_id::text = split_part(name,'/',1) and j.created_by = auth.uid() and j.status = 'pending')
));
create policy question_images_teacher_delete on storage.objects for delete to authenticated
using(bucket_id = 'question-images' and public.is_teacher() and (
  name like 'question-import-staging/' || auth.uid()::text || '/%'
  or exists(select 1 from public.exams e where e.id::text = split_part(name,'/',1) and e.created_by = auth.uid())
  or exists(select 1 from public.storage_cleanup_jobs j where j.path = name and j.created_by = auth.uid())
  or exists(select 1 from public.exam_duplication_jobs j where j.target_exam_id::text = split_part(name,'/',1) and j.created_by = auth.uid() and j.status = 'pending')
));

revoke all on function public.exam_publish_validation(uuid) from public,anon;
revoke all on function public.teacher_exam_attempt_counts(uuid[]) from public,anon;
revoke all on function public.update_exam_metadata(uuid,text,text,text,timestamptz,timestamptz,timestamptz,text,uuid) from public,anon;
revoke all on function public.reschedule_exam(uuid,timestamptz,timestamptz,boolean,timestamptz,text,uuid) from public,anon;
revoke all on function public.publish_exam(uuid,uuid) from public,anon;
revoke all on function public.archive_exam(uuid,text,uuid) from public,anon;
revoke all on function public.close_exam(uuid,text,uuid) from public,anon;
revoke all on function public.restore_exam(uuid,text,uuid) from public,anon;
revoke all on function public.delete_exam(uuid,text,text,uuid) from public,anon;
revoke all on function public.acknowledge_storage_cleanup(text[]) from public,anon;
revoke all on function public.begin_exam_duplication(uuid,uuid,uuid) from public,anon;
revoke all on function public.complete_exam_duplication(uuid,text,jsonb,uuid) from public,anon;
revoke all on function public.replace_question_image(uuid,text,text,text,uuid) from public,anon;

grant execute on function public.exam_publish_validation(uuid) to authenticated;
grant execute on function public.teacher_exam_attempt_counts(uuid[]) to authenticated;
grant execute on function public.update_exam_metadata(uuid,text,text,text,timestamptz,timestamptz,timestamptz,text,uuid) to authenticated;
grant execute on function public.reschedule_exam(uuid,timestamptz,timestamptz,boolean,timestamptz,text,uuid) to authenticated;
grant execute on function public.publish_exam(uuid,uuid) to authenticated;
grant execute on function public.archive_exam(uuid,text,uuid) to authenticated;
grant execute on function public.close_exam(uuid,text,uuid) to authenticated;
grant execute on function public.restore_exam(uuid,text,uuid) to authenticated;
grant execute on function public.delete_exam(uuid,text,text,uuid) to authenticated;
grant execute on function public.acknowledge_storage_cleanup(text[]) to authenticated;
grant execute on function public.begin_exam_duplication(uuid,uuid,uuid) to authenticated;
grant execute on function public.complete_exam_duplication(uuid,text,jsonb,uuid) to authenticated;
grant execute on function public.replace_question_image(uuid,text,text,text,uuid) to authenticated;
