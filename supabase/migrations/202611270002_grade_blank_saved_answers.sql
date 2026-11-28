-- A cleared answer is stored as a row with selected_option = NULL. SQL's
-- equality operator returns NULL for it, while answer_results.is_correct is
-- NOT NULL. Treat a cleared answer as incorrect without changing scoring.
create or replace function public.recalculate_attempt_score(target_attempt uuid)
returns void
language plpgsql security definer set search_path=''
as $$
declare score integer; total integer;
begin
  insert into public.answer_results(answer_id,is_correct)
    select ans.id,coalesce(ans.selected_option = k.correct_option,false)
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

revoke all on function public.recalculate_attempt_score(uuid) from public,anon,authenticated;
