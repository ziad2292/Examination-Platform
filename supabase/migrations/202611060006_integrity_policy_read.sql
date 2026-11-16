create function public.student_attempt_integrity_policy(target_attempt uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.is_active_user() then raise exception 'Attempt not found' using errcode='42501';end if;
 select jsonb_build_object('enabled',coalesce((s.policy->>'enabled')::boolean,false),'policy',s.policy,'fullscreenException',s.fullscreen_exception,'count',s.counted_incidents,'reviewRequired',s.review_required,'reviewCycle',s.review_cycle,'overlap',s.overlap_active,'acknowledged','[]'::jsonb)
 into result from public.attempt_integrity_state s join public.exam_attempts a on a.id=s.attempt_id where a.id=target_attempt and a.student_id=auth.uid();
 if result is null then raise exception 'Attempt not found' using errcode='42501';end if;return result;
end $$;
revoke all on function public.student_attempt_integrity_policy(uuid) from public,anon;
grant execute on function public.student_attempt_integrity_policy(uuid) to authenticated;
