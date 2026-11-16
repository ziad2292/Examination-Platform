begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(5);
insert into public.exams(id,title,status,scheduled_start_at,scheduled_end_at,created_by)
values('f1000000-0000-0000-0000-000000000001','Summary fixture','published',now()-interval '1 day',now()+interval '1 day','10000000-0000-0000-0000-000000000001');
insert into public.exam_attempts(id,exam_id,student_id,generation,status,completed_at,raw_score,total_questions)
values('f1000000-0000-0000-0000-000000000002','f1000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',1,'completed',now(),1,2),
('f1000000-0000-0000-0000-000000000003','f1000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',2,'in_progress',null,null,null);
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is((select id from public.student_dashboard_attempt_summaries(array['f1000000-0000-0000-0000-000000000001']::uuid[])),
'f1000000-0000-0000-0000-000000000003'::uuid,'latest generation is selected');
select is((select status::text from public.student_dashboard_attempt_summaries(array['f1000000-0000-0000-0000-000000000001']::uuid[])),
'in_progress','status matches existing summary');
select is((select count(*)::integer from public.student_dashboard_attempt_summaries(array['f1000000-0000-0000-0000-000000000001']::uuid[])),1,'one summary per exam');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is((select count(*)::integer from public.student_dashboard_attempt_summaries(array['f1000000-0000-0000-0000-000000000001']::uuid[])),0,'other student cannot retrieve summary');
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select is((select count(*)::integer from public.student_dashboard_attempt_summaries(array['f1000000-0000-0000-0000-000000000001']::uuid[])),0,'teacher cannot use student summary');
select * from finish();
rollback;
