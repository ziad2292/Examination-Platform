-- Disposable LOCAL test database only, following existing dblink test conventions.
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink;
set search_path=public,extensions;
delete from public.exam_attempts where exam_id='ab100000-0000-4000-8000-000000000001';
delete from public.exams where id='ab100000-0000-4000-8000-000000000001';
insert into public.exams(id,title,status,scheduled_start_at,scheduled_end_at,created_by)
values('ab100000-0000-4000-8000-000000000001','Concurrent integrity fixture','published',now()-interval '1 hour',now()+interval '1 hour','10000000-0000-0000-0000-000000000001');
insert into public.exam_sections(id,exam_id,title,section_type,section_order,duration_seconds)
values('ab100000-0000-4000-8000-000000000002','ab100000-0000-4000-8000-000000000001','Module','module',1,600);
insert into public.exam_integrity_settings(exam_id,enabled,enforcement,threshold)
values('ab100000-0000-4000-8000-000000000001',true,true,1);
insert into public.exam_attempts(id,exam_id,student_id)
values('ab100000-0000-4000-8000-000000000003','ab100000-0000-4000-8000-000000000001','20000000-0000-0000-0000-000000000001');
insert into public.section_attempts(id,exam_attempt_id,section_id,expires_at)
values('ab100000-0000-4000-8000-000000000004','ab100000-0000-4000-8000-000000000003','ab100000-0000-4000-8000-000000000002',now()+interval '10 minutes');
select plan(6);
update public.attempt_integrity_state set retained_count=2,counted_incidents=2 where attempt_id='ab100000-0000-4000-8000-000000000003';
select dblink_connect('integrity_a',format('dbname=%I user=postgres password=postgres host=host.docker.internal port=54322',current_database()));
select dblink_connect('integrity_b',format('dbname=%I user=postgres password=postgres host=host.docker.internal port=54322',current_database()));
select dblink_exec('integrity_a','set role authenticated');
select dblink_exec('integrity_b','set role authenticated');
select * from dblink('integrity_a',$$select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',false)$$) as t(value text);
select * from dblink('integrity_b',$$select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',false)$$) as t(value text);
create function public.test_concurrent_integrity() returns jsonb language sql as $$
 select public.integrity_sync('ab100000-0000-4000-8000-000000000003','ab100000-0000-4000-8000-000000000010','ab100000-0000-4000-8000-000000000011',
 jsonb_build_array(jsonb_build_object('eventId','ab100000-0000-4000-8000-000000000100','sequence',1,'type','clipboard','sectionAttemptId','ab100000-0000-4000-8000-000000000004','observedAt',now(),'metadata','{}'::jsonb)),true)
$$;
select dblink_send_query('integrity_a','select public.test_concurrent_integrity()');
select dblink_send_query('integrity_b','select public.test_concurrent_integrity()');
select is((select (result->>'count')::integer from dblink_get_result('integrity_a') as t(result jsonb)),3,'first concurrent ingestion crosses the fixed threshold');
select is((select (result->>'count')::integer from dblink_get_result('integrity_b') as t(result jsonb)),3,'concurrent replay returns the same count');
select is((select count(*)::integer from public.attempt_integrity_events where attempt_id='ab100000-0000-4000-8000-000000000003'),1,'concurrent ingestion writes one immutable event');
select is((select review_cycle from public.attempt_integrity_state where attempt_id='ab100000-0000-4000-8000-000000000003'),1,'concurrent threshold crossing creates one review cycle');
select is((select counted_incidents from public.attempt_integrity_state where attempt_id='ab100000-0000-4000-8000-000000000003'),3,'concurrent aggregate is atomic');
select is((select status::text from public.exam_attempts where id='ab100000-0000-4000-8000-000000000003'),'in_progress','concurrent threshold never submits attempt');
select dblink_disconnect('integrity_a');
select dblink_disconnect('integrity_b');
drop function public.test_concurrent_integrity();
delete from public.exam_attempts where exam_id='ab100000-0000-4000-8000-000000000001';
delete from public.exams where id='ab100000-0000-4000-8000-000000000001';
select * from finish();
