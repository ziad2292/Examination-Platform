create type public.question_import_status as enum ('pending', 'completed', 'failed');

create table public.question_import_batches (
  id uuid primary key,
  section_id uuid not null references public.exam_sections(id) on delete cascade,
  exam_id uuid not null references public.exams(id) on delete cascade,
  created_by uuid not null references public.profiles(id),
  status public.question_import_status not null default 'pending',
  question_count integer not null check (question_count between 1 and 50),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  check ((status = 'completed' and completed_at is not null) or status <> 'completed')
);

create table public.question_import_items (
  batch_id uuid not null references public.question_import_batches(id) on delete cascade,
  question_id uuid not null unique references public.questions(id) on delete cascade,
  item_order integer not null check (item_order > 0),
  image_path text not null,
  original_filename text not null check (length(original_filename) between 1 and 255),
  content_sha256 text not null check (content_sha256 ~ '^[a-f0-9]{64}$'),
  primary key (batch_id, item_order),
  unique (batch_id, image_path),
  unique (batch_id, content_sha256)
);

create unique index questions_image_path_unique
  on public.questions(image_path)
  where image_path is not null;

create index question_import_batches_owner_idx
  on public.question_import_batches(created_by, created_at desc);

alter table public.question_import_batches enable row level security;
alter table public.question_import_items enable row level security;

create policy question_import_batches_teacher_read
on public.question_import_batches for select to authenticated
using(created_by = auth.uid() and public.owns_exam(exam_id));

create policy question_import_items_teacher_read
on public.question_import_items for select to authenticated
using(exists(
  select 1 from public.question_import_batches b
  where b.id = batch_id and b.created_by = auth.uid() and public.owns_exam(b.exam_id)
));

create or replace function public.bulk_create_questions(
  target_exam uuid,
  target_section uuid,
  import_batch uuid,
  import_items jsonb
) returns table(
  batch_id uuid,
  result_status public.question_import_status,
  question_count integer,
  question_ids uuid[]
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  item_count integer;
  storage_count integer;
  total_bytes bigint;
  next_order integer;
  existing public.question_import_batches;
  target_type public.section_type;
  target_status public.exam_status;
  expected_prefix text;
begin
  if caller_id is null or not public.is_teacher() then
    raise exception 'Teacher account required';
  end if;

  if jsonb_typeof(import_items) <> 'array' then
    raise exception 'Import items must be an array';
  end if;
  item_count := jsonb_array_length(import_items);
  if item_count not between 1 and 50 then
    raise exception 'Import must contain between 1 and 50 questions';
  end if;

  perform 1 from public.exam_sections
    where id = target_section and exam_id = target_exam
    for update;
  if not found or not public.owns_exam(target_exam) then
    raise exception 'Section not found';
  end if;

  select s.section_type, e.status into target_type, target_status
  from public.exam_sections s
  join public.exams e on e.id = s.exam_id
  where s.id = target_section and e.id = target_exam;
  if target_type <> 'module' then
    raise exception 'Questions can only be imported into a module';
  end if;
  if target_status not in ('draft', 'published') then
    raise exception 'Exam is not editable';
  end if;
  if exists(select 1 from public.exam_attempts where exam_id = target_exam) then
    raise exception 'Exam is locked';
  end if;

  insert into public.question_import_batches(
    id, section_id, exam_id, created_by, status, question_count
  ) values (
    import_batch, target_section, target_exam, caller_id, 'pending', item_count
  ) on conflict (id) do nothing;

  select * into existing
  from public.question_import_batches
  where id = import_batch
  for update;

  if existing.id is null
    or existing.created_by <> caller_id
    or existing.exam_id <> target_exam
    or existing.section_id <> target_section
  then
    raise exception 'Batch identifier is already in use';
  end if;

  if existing.status = 'completed' then
    return query
      select existing.id, existing.status, existing.question_count,
        coalesce(array_agg(i.question_id order by i.item_order), array[]::uuid[])
      from public.question_import_items i
      where i.batch_id = existing.id;
    return;
  end if;

  if existing.question_count <> item_count then
    raise exception 'Batch contents changed during retry';
  end if;

  if exists(
    select 1 from jsonb_array_elements(import_items) item
    where jsonb_typeof(item) <> 'object'
      or coalesce(item->>'position', '') !~ '^[1-9][0-9]*$'
      or coalesce(item->>'correctOption', '') not in ('A', 'B', 'C', 'D')
      or length(coalesce(item->>'originalFilename', '')) not between 1 and 255
      or coalesce(item->>'sha256', '') !~ '^[a-f0-9]{64}$'
  ) then
    raise exception 'Invalid import item';
  end if;

  if (
    select count(distinct (item->>'position')::integer) <> item_count
      or min((item->>'position')::integer) <> 1
      or max((item->>'position')::integer) <> item_count
      or count(distinct item->>'imagePath') <> item_count
      or count(distinct item->>'sha256') <> item_count
    from jsonb_array_elements(import_items) item
  ) then
    raise exception 'Import positions, images, and content must be unique and contiguous';
  end if;

  expected_prefix := 'question-import-staging/' || caller_id::text || '/' || import_batch::text || '/';
  if exists(
    select 1 from jsonb_array_elements(import_items) item
    where item->>'imagePath' not like expected_prefix || '%'
      or substring(item->>'imagePath' from length(expected_prefix) + 1) !~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$'
  ) then
    raise exception 'Invalid staged image path';
  end if;

  select count(*), coalesce(sum((o.metadata->>'size')::bigint), 0)
    into storage_count, total_bytes
  from storage.objects o
  join jsonb_array_elements(import_items) item
    on item->>'imagePath' = o.name
  where o.bucket_id = 'question-images'
    and o.owner = caller_id
    and o.metadata->>'mimetype' in ('image/png', 'image/jpeg', 'image/webp')
    and coalesce((o.metadata->>'size')::bigint, 0) between 1 and 8388608;

  if storage_count <> item_count then
    raise exception 'One or more staged images are missing or invalid';
  end if;
  if total_bytes > 104857600 then
    raise exception 'Import exceeds the total upload limit';
  end if;

  select coalesce(max(q.question_order), 0) into next_order
  from public.questions q
  where q.section_id = target_section;

  insert into public.questions(
    section_id, question_order, image_path, optional_text,
    option_a, option_b, option_c, option_d
  )
  select
    target_section,
    next_order + (item->>'position')::integer,
    item->>'imagePath',
    null,
    'A', 'B', 'C', 'D'
  from jsonb_array_elements(import_items) item
  order by (item->>'position')::integer;

  insert into public.question_keys(question_id, correct_option)
  select q.id, (item->>'correctOption')::public.answer_option
  from jsonb_array_elements(import_items) item
  join public.questions q
    on q.section_id = target_section and q.image_path = item->>'imagePath';

  insert into public.question_import_items(
    batch_id, question_id, item_order, image_path, original_filename, content_sha256
  )
  select
    import_batch,
    q.id,
    (item->>'position')::integer,
    item->>'imagePath',
    item->>'originalFilename',
    item->>'sha256'
  from jsonb_array_elements(import_items) item
  join public.questions q
    on q.section_id = target_section and q.image_path = item->>'imagePath';

  update public.question_import_batches
  set status = 'completed', completed_at = now()
  where id = import_batch;

  return query
    select b.id, b.status, b.question_count,
      array_agg(i.question_id order by i.item_order)
    from public.question_import_batches b
    join public.question_import_items i on i.batch_id = b.id
    where b.id = import_batch
    group by b.id;
end
$$;

revoke all on function public.bulk_create_questions(uuid, uuid, uuid, jsonb) from public;
revoke all on function public.bulk_create_questions(uuid, uuid, uuid, jsonb) from anon;
grant execute on function public.bulk_create_questions(uuid, uuid, uuid, jsonb) to authenticated;

drop policy if exists question_images_teacher_write on storage.objects;
drop policy if exists question_images_teacher_update on storage.objects;
drop policy if exists question_images_teacher_delete on storage.objects;
drop policy if exists question_images_authorized_read on storage.objects;

create policy question_images_teacher_write on storage.objects for insert to authenticated
with check(
  bucket_id = 'question-images'
  and public.is_teacher()
  and (
    name like 'question-import-staging/' || auth.uid()::text || '/%'
    or exists(
      select 1 from public.exams e
      where e.id::text = split_part(name, '/', 1) and e.created_by = auth.uid()
    )
  )
);

create policy question_images_teacher_update on storage.objects for update to authenticated
using(
  bucket_id = 'question-images'
  and public.is_teacher()
  and (
    name like 'question-import-staging/' || auth.uid()::text || '/%'
    or exists(
      select 1 from public.exams e
      where e.id::text = split_part(name, '/', 1) and e.created_by = auth.uid()
    )
  )
)
with check(
  bucket_id = 'question-images'
  and public.is_teacher()
  and (
    name like 'question-import-staging/' || auth.uid()::text || '/%'
    or exists(
      select 1 from public.exams e
      where e.id::text = split_part(name, '/', 1) and e.created_by = auth.uid()
    )
  )
);

create policy question_images_teacher_delete on storage.objects for delete to authenticated
using(
  bucket_id = 'question-images'
  and public.is_teacher()
  and (
    name like 'question-import-staging/' || auth.uid()::text || '/%'
    or exists(
      select 1 from public.exams e
      where e.id::text = split_part(name, '/', 1) and e.created_by = auth.uid()
    )
  )
);

create policy question_images_authorized_read on storage.objects for select to authenticated
using(
  bucket_id = 'question-images'
  and (
    name like 'question-import-staging/' || auth.uid()::text || '/%'
    or exists(
      select 1
      from public.questions q
      join public.exam_sections s on s.id = q.section_id
      where q.image_path = storage.objects.name
        and (
          public.owns_exam(s.exam_id)
          or exists(
            select 1 from public.exam_attempts a
            where a.exam_id = s.exam_id and a.student_id = auth.uid()
          )
        )
    )
  )
);
