-- Preserve the existing per-exam summary's latest-generation and privacy rules
-- while serving the assigned-exam dashboard in one database request.
create function public.student_dashboard_attempt_summaries(target_exams uuid[])
returns table(exam_id uuid,id uuid,status public.attempt_status)
language sql stable security definer set search_path='' as $$
  select distinct on (a.exam_id) a.exam_id,a.id,a.status
  from public.exam_attempts a
  where public.is_active_user()
    and exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='student' and p.is_active)
    and a.student_id=auth.uid()
    and a.exam_id=any(target_exams)
  order by a.exam_id,a.generation desc
$$;
revoke all on function public.student_dashboard_attempt_summaries(uuid[]) from public,anon;
grant execute on function public.student_dashboard_attempt_summaries(uuid[]) to authenticated;
