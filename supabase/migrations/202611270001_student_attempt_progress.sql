-- Return the progress screen in one authorized PostgREST call. Keep the older
-- summary RPC for existing clients and mask marks while results are hidden.
create function public.student_attempt_progress(target_attempt uuid)
returns jsonb
language sql stable security definer set search_path=''
as $$
  select jsonb_build_object(
    'id', a.id,
    'status', a.status,
    'raw_score', case when e.show_results_to_students then a.raw_score else null end,
    'total_questions', case when e.show_results_to_students then a.total_questions else null end,
    'exam_id', e.id,
    'exam_title', e.title,
    'results_visible', e.show_results_to_students,
    'sections', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'title', s.title,
        'section_type', s.section_type,
        'section_order', s.section_order,
        'duration_seconds', s.duration_seconds,
        'question_count', (select count(*) from public.questions q where q.section_id=s.id),
        'section_attempts', coalesce((
          select jsonb_agg(jsonb_build_object('id', sa.id, 'status', sa.status))
          from public.section_attempts sa
          where sa.exam_attempt_id=a.id and sa.section_id=s.id
        ), '[]'::jsonb)
      ) order by s.section_order)
      from public.exam_sections s where s.exam_id=e.id
    ), '[]'::jsonb)
  )
  from public.exam_attempts a
  join public.exams e on e.id=a.exam_id
  join public.profiles p on p.id=a.student_id and p.role='student' and p.is_active
  where a.id=target_attempt and a.student_id=auth.uid()
$$;

revoke all on function public.student_attempt_progress(uuid) from public,anon;
grant execute on function public.student_attempt_progress(uuid) to authenticated;
