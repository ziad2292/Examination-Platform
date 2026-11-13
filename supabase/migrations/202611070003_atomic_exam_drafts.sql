create function public.create_exam_draft(
  request_id uuid, exam_title text, exam_description text, exam_instructions text,
  starts_at timestamptz, ends_at timestamptz, access_code text, show_results boolean
) returns uuid language plpgsql security definer set search_path='' as $$
declare created uuid;
begin
  if not public.is_teacher() then raise exception 'Teacher access required' using errcode='42501'; end if;
  insert into public.exams(id,title,description,instructions,scheduled_start_at,scheduled_end_at,
    access_code_required,show_results_to_students,created_by)
  values(request_id,exam_title,exam_description,exam_instructions,starts_at,ends_at,
    access_code is not null,show_results,auth.uid())
  on conflict(id) do nothing returning id into created;
  if created is null then
    if not public.owns_exam(request_id) then raise exception 'Invalid request ID'; end if;
    return request_id;
  end if;
  if access_code is not null then
    insert into public.exam_access_codes(exam_id,access_code) values(created,access_code);
  end if;
  return created;
end $$;
revoke all on function public.create_exam_draft(uuid,text,text,text,timestamptz,timestamptz,text,boolean) from public,anon;
grant execute on function public.create_exam_draft(uuid,text,text,text,timestamptz,timestamptz,text,boolean) to authenticated;
