begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(5);
insert into public.exams(id,title,scheduled_start_at,scheduled_end_at,created_by,show_results_to_students)
values('fa000000-0000-4000-8000-000000000001','Duplication settings fixture',now()+interval '1 day',now()+interval '2 days','10000000-0000-0000-0000-000000000001',true);
insert into public.exam_sections(exam_id,title,section_type,section_order,duration_seconds,allow_calculator)
values('fa000000-0000-4000-8000-000000000001','Calculator module','module',1,600,true);
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.begin_exam_duplication('fa000000-0000-4000-8000-000000000001','fa000000-0000-4000-8000-000000000002','fa000000-0000-4000-8000-000000000003')$$,'begin disposable duplication');
select lives_ok($$select public.complete_exam_duplication('fa000000-0000-4000-8000-000000000002','Copied settings fixture','{}','fa000000-0000-4000-8000-000000000003')$$,'complete disposable duplication');
select is((select show_results_to_students from public.exams where id='fa000000-0000-4000-8000-000000000002'),true,'duplicate preserves result visibility');
select is((select allow_calculator from public.exam_sections where exam_id='fa000000-0000-4000-8000-000000000002'),true,'duplicate preserves calculator permission');
select is((select count(*)::integer from public.exam_attempts where exam_id='fa000000-0000-4000-8000-000000000002'),0,'duplicate never copies attempts');
select * from finish();
rollback;
