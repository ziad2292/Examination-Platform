-- Preserve per-exam and per-module settings when copying assessment content.
create or replace function public.complete_exam_duplication(
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

  insert into public.exams(id,title,description,instructions,access_code_required,status,scheduled_start_at,scheduled_end_at,created_by,show_results_to_students)
    values(target_exam,trim(new_title),source.description,source.instructions,false,'draft',now()+interval '1 day',now()+interval '8 days',auth.uid(),source.show_results_to_students);

  for source_section in
    select * from public.exam_sections where exam_id = source.id order by section_order
  loop
    new_section := gen_random_uuid();
    insert into public.exam_sections(id,exam_id,title,section_type,section_order,duration_seconds,allow_calculator)
      values(new_section,target_exam,source_section.title,source_section.section_type,source_section.section_order,source_section.duration_seconds,source_section.allow_calculator);
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
