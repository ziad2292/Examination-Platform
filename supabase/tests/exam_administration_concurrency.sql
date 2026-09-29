create extension if not exists pgtap with schema extensions;
create extension if not exists dblink;
set search_path=public,extensions;
select no_plan();

drop function if exists public.test_try_reschedule(uuid,timestamptz,timestamptz,uuid);
drop function if exists public.test_try_teacher_submit(uuid,uuid);
drop function if exists public.test_try_archive(uuid,uuid);
drop function if exists public.test_try_start(uuid,uuid);
drop function if exists public.test_try_reset(uuid,uuid);
drop function if exists public.test_try_save(uuid,uuid);
drop function if exists public.test_try_regrade(uuid,uuid);
drop function if exists public.test_try_delete(uuid,uuid);
drop function if exists public.test_try_edit(uuid,timestamptz,uuid);

create function public.test_try_reschedule(target uuid,new_end timestamptz,expected timestamptz,op uuid) returns text
language plpgsql security definer set search_path='' as $$begin
  perform set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
  perform public.reschedule_exam(target,(select scheduled_start_at from public.exams where id=target),new_end,false,expected,'Concurrent reschedule',op);
  return 'ok'; exception when others then return sqlerrm; end$$;
create function public.test_try_teacher_submit(target uuid,op uuid) returns text
language plpgsql security definer set search_path='' as $$begin
  perform set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
  perform public.teacher_submit_attempt(target,'Concurrent manual submit',op);
  return 'ok'; exception when others then return sqlerrm; end$$;
create function public.test_try_archive(target uuid,op uuid) returns text
language plpgsql security definer set search_path='' as $$begin
  perform set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
  perform public.archive_exam(target,'Concurrent archive',op);
  return 'ok'; exception when others then return sqlerrm; end$$;
create function public.test_try_start(target uuid,student uuid) returns text
language plpgsql security definer set search_path='' as $$begin
  perform set_config('request.jwt.claim.sub',student::text,false);
  perform public.start_exam(target,null);
  return 'ok'; exception when others then return sqlerrm; end$$;
create function public.test_try_reset(target uuid,op uuid) returns text
language plpgsql security definer set search_path='' as $$begin
  perform set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
  perform public.reset_attempt(target,'Concurrent reset',op);
  return 'ok'; exception when others then return sqlerrm; end$$;
create function public.test_try_save(section_attempt uuid,question uuid) returns text
language plpgsql security definer set search_path='' as $$begin
  perform set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',false);
  perform public.save_answer(section_attempt,question,'A',false,1);
  return 'ok'; exception when others then return sqlerrm; end$$;
create function public.test_try_regrade(question uuid,op uuid) returns text
language plpgsql security definer set search_path='' as $$begin
  perform set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
  perform public.correct_answer_key(question,'B','Concurrent key correction',op);
  return 'ok'; exception when others then return sqlerrm; end$$;
create function public.test_try_delete(target uuid,op uuid) returns text
language plpgsql security definer set search_path='' as $$begin
  perform set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
  perform public.delete_exam(target,'Delete edit race','Concurrent deletion',op);
  return 'ok'; exception when others then return sqlerrm; end$$;
create function public.test_try_edit(target uuid,expected timestamptz,op uuid) returns text
language plpgsql security definer set search_path='' as $$begin
  perform set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
  perform public.update_exam_metadata(target,'Edited during race','','',
    (select scheduled_start_at from public.exams where id=target),
    (select scheduled_end_at from public.exams where id=target),expected,'Concurrent edit',op);
  return 'ok'; exception when others then return sqlerrm; end$$;

insert into public.exams(id,title,status,scheduled_start_at,scheduled_end_at,created_by) values
  ('c0000000-0000-4000-8000-000000000001','Reschedule race','draft',now()+interval '1 day',now()+interval '2 days','10000000-0000-0000-0000-000000000001'),
  ('c0000000-0000-4000-8000-000000000002','Submit race','published',now()-interval '1 hour',now()+interval '2 hours','10000000-0000-0000-0000-000000000001'),
  ('c0000000-0000-4000-8000-000000000003','Archive start race','published',now()-interval '1 hour',now()+interval '2 hours','10000000-0000-0000-0000-000000000001'),
  ('c0000000-0000-4000-8000-000000000004','Reset save race','published',now()-interval '1 hour',now()+interval '2 hours','10000000-0000-0000-0000-000000000001'),
  ('c0000000-0000-4000-8000-000000000005','Regrade race','closed',now()-interval '2 hours',now()-interval '1 hour','10000000-0000-0000-0000-000000000001'),
  ('c0000000-0000-4000-8000-000000000006','Delete edit race','draft',now()+interval '1 day',now()+interval '2 days','10000000-0000-0000-0000-000000000001');
insert into public.exam_sections(id,exam_id,title,section_type,section_order,duration_seconds) values
  ('c1000000-0000-4000-8000-000000000004','c0000000-0000-4000-8000-000000000004','Module','module',1,600),
  ('c1000000-0000-4000-8000-000000000005','c0000000-0000-4000-8000-000000000005','Module','module',1,600);
insert into public.questions(id,section_id,question_order,optional_text,option_a,option_b,option_c,option_d) values
  ('c2000000-0000-4000-8000-000000000004','c1000000-0000-4000-8000-000000000004',1,'Race question','A','B','C','D'),
  ('c2000000-0000-4000-8000-000000000005','c1000000-0000-4000-8000-000000000005',1,'Regrade question','A','B','C','D');
insert into public.question_keys(question_id,correct_option) values
  ('c2000000-0000-4000-8000-000000000004','A'),
  ('c2000000-0000-4000-8000-000000000005','A');
insert into public.exam_attempts(id,exam_id,student_id,status,completed_at,raw_score,total_questions) values
  ('c3000000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-000000000002','20000000-0000-0000-0000-000000000001','in_progress',null,null,null),
  ('c3000000-0000-4000-8000-000000000004','c0000000-0000-4000-8000-000000000004','20000000-0000-0000-0000-000000000002','in_progress',null,null,null),
  ('c3000000-0000-4000-8000-000000000005','c0000000-0000-4000-8000-000000000005','20000000-0000-0000-0000-000000000003','completed',now(),0,1);
insert into public.section_attempts(id,exam_attempt_id,section_id,started_at,expires_at) values
  ('c4000000-0000-4000-8000-000000000004','c3000000-0000-4000-8000-000000000004','c1000000-0000-4000-8000-000000000004',now(),now()+interval '10 minutes'),
  ('c4000000-0000-4000-8000-000000000005','c3000000-0000-4000-8000-000000000005','c1000000-0000-4000-8000-000000000005',now()-interval '2 hours',now()-interval '1 hour');
update public.section_attempts set status='submitted',submitted_at=now() where id='c4000000-0000-4000-8000-000000000005';
insert into public.answers(id,exam_attempt_id,section_attempt_id,question_id,selected_option) values
  ('c5000000-0000-4000-8000-000000000005','c3000000-0000-4000-8000-000000000005','c4000000-0000-4000-8000-000000000005','c2000000-0000-4000-8000-000000000005','A');
insert into public.answer_results(answer_id,is_correct) values('c5000000-0000-4000-8000-000000000005',true);
update public.exam_attempts set raw_score=1,total_questions=1 where id='c3000000-0000-4000-8000-000000000005';

select dblink_connect('admin_a',format('dbname=%I user=postgres password=postgres host=host.docker.internal port=54322',current_database()));
select dblink_connect('admin_b',format('dbname=%I user=postgres password=postgres host=host.docker.internal port=54322',current_database()));
create temporary table race_results(result text);

-- Two stale-tab reschedules serialize; one wins and one receives the optimistic-lock error.
select dblink_send_query('admin_a',format($q$select public.test_try_reschedule('c0000000-0000-4000-8000-000000000001',now()+interval '3 days','%s','c9000000-0000-4000-8000-000000000001')$q$,(select updated_at from public.exams where id='c0000000-0000-4000-8000-000000000001')));
select dblink_send_query('admin_b',format($q$select public.test_try_reschedule('c0000000-0000-4000-8000-000000000001',now()+interval '4 days','%s','c9000000-0000-4000-8000-000000000002')$q$,(select updated_at from public.exams where id='c0000000-0000-4000-8000-000000000001')));
insert into race_results select result from dblink_get_result('admin_a') as t(result text);
insert into race_results select result from dblink_get_result('admin_b') as t(result text);
select count(*) from dblink_get_result('admin_a') as t(result text);
select count(*) from dblink_get_result('admin_b') as t(result text);
select is((select count(*)::integer from race_results where result='ok'),1,'one concurrent reschedule wins');
select is((select count(*)::integer from race_results where result='Exam changed in another session'),1,'stale concurrent reschedule is rejected');

-- Deletion and metadata editing share the exam row lock; no partial draft survives.
truncate race_results;
select dblink_send_query('admin_a',$$select public.test_try_delete('c0000000-0000-4000-8000-000000000006','c9000000-0000-4000-8000-000000000007')$$);
select dblink_send_query('admin_b',format($q$select public.test_try_edit('c0000000-0000-4000-8000-000000000006','%s','c9000000-0000-4000-8000-000000000008')$q$,(select updated_at from public.exams where id='c0000000-0000-4000-8000-000000000006')));
insert into race_results select result from dblink_get_result('admin_a') as t(result text);
insert into race_results select result from dblink_get_result('admin_b') as t(result text);
select count(*) from dblink_get_result('admin_a') as t(result text);
select count(*) from dblink_get_result('admin_b') as t(result text);
select is((select count(*)::integer from race_results where result='ok'),1,'exactly one delete-or-edit operation wins');
select ok(
  not exists(select 1 from public.exams where id='c0000000-0000-4000-8000-000000000006')
  or (select title='Edited during race' from public.exams where id='c0000000-0000-4000-8000-000000000006'),
  'delete/edit race leaves either no draft or the complete edit'
);

-- Duplicate manual-submit clicks converge to one terminal result and one audit event.
truncate race_results;
select dblink_send_query('admin_a',$$select public.test_try_teacher_submit('c3000000-0000-4000-8000-000000000002','c9000000-0000-4000-8000-000000000003')$$);
select dblink_send_query('admin_b',$$select public.test_try_teacher_submit('c3000000-0000-4000-8000-000000000002','c9000000-0000-4000-8000-000000000003')$$);
insert into race_results select result from dblink_get_result('admin_a') as t(result text);
insert into race_results select result from dblink_get_result('admin_b') as t(result text);
select count(*) from dblink_get_result('admin_a') as t(result text);
select count(*) from dblink_get_result('admin_b') as t(result text);
select is((select count(*)::integer from race_results where result='ok'),2,'duplicate concurrent manual submits are both idempotent');
select is((select status::text from public.exam_attempts where id='c3000000-0000-4000-8000-000000000002'),'completed','manual-submit race produces one terminal state');
select is((select count(*)::integer from public.admin_audit_events where idempotency_key='c9000000-0000-4000-8000-000000000003'),1,'manual-submit race writes one audit event');

-- Archive and student start share the exam lock; the database never strands an active attempt.
truncate race_results;
select dblink_send_query('admin_a',$$select public.test_try_archive('c0000000-0000-4000-8000-000000000003','c9000000-0000-4000-8000-000000000004')$$);
select dblink_send_query('admin_b',$$select public.test_try_start('c0000000-0000-4000-8000-000000000003','20000000-0000-0000-0000-000000000004')$$);
insert into race_results select result from dblink_get_result('admin_a') as t(result text);
insert into race_results select result from dblink_get_result('admin_b') as t(result text);
select count(*) from dblink_get_result('admin_a') as t(result text);
select count(*) from dblink_get_result('admin_b') as t(result text);
select is((select count(*)::integer from race_results where result='ok'),1,'exactly one archive-or-start operation wins');
select ok(not ((select status='archived' from public.exams where id='c0000000-0000-4000-8000-000000000003') and exists(select 1 from public.exam_attempts where exam_id='c0000000-0000-4000-8000-000000000003' and status='in_progress')),'archive/start race cannot strand an active attempt');

-- Reset and answer save use the same lock order and converge without partial history loss.
truncate race_results;
select dblink_send_query('admin_a',$$select public.test_try_reset('c3000000-0000-4000-8000-000000000004','c9000000-0000-4000-8000-000000000005')$$);
select dblink_send_query('admin_b',$$select public.test_try_save('c4000000-0000-4000-8000-000000000004','c2000000-0000-4000-8000-000000000004')$$);
insert into race_results select result from dblink_get_result('admin_a') as t(result text);
insert into race_results select result from dblink_get_result('admin_b') as t(result text);
select count(*) from dblink_get_result('admin_a') as t(result text);
select count(*) from dblink_get_result('admin_b') as t(result text);
select is((select status::text from public.exam_attempts where id='c3000000-0000-4000-8000-000000000004'),'expired','reset/save race always closes the original attempt');
select ok((select count(*) from public.answers where exam_attempt_id='c3000000-0000-4000-8000-000000000004') <= 1,'reset/save race never duplicates an answer');
select is((select count(*)::integer from public.exam_retake_grants where source_attempt_id='c3000000-0000-4000-8000-000000000004' and consumed_at is null),1,'reset/save race creates one retake grant');

-- Duplicate correction requests serialize around the exam/key locks and regrade once.
truncate race_results;
select dblink_send_query('admin_a',$$select public.test_try_regrade('c2000000-0000-4000-8000-000000000005','c9000000-0000-4000-8000-000000000006')$$);
select dblink_send_query('admin_b',$$select public.test_try_regrade('c2000000-0000-4000-8000-000000000005','c9000000-0000-4000-8000-000000000006')$$);
insert into race_results select result from dblink_get_result('admin_a') as t(result text);
insert into race_results select result from dblink_get_result('admin_b') as t(result text);
select count(*) from dblink_get_result('admin_a') as t(result text);
select count(*) from dblink_get_result('admin_b') as t(result text);
select is((select count(*)::integer from race_results where result='ok'),2,'duplicate concurrent regrades are idempotent');
select is((select count(*)::integer from public.answer_key_corrections where operation_key='c9000000-0000-4000-8000-000000000006'),1,'regrade race stores one correction history row');
select is((select raw_score from public.exam_attempts where id='c3000000-0000-4000-8000-000000000005'),0,'regrade race leaves the deterministic corrected score');

select dblink_disconnect('admin_a');
select dblink_disconnect('admin_b');
select * from finish();

drop function public.test_try_reschedule(uuid,timestamptz,timestamptz,uuid);
drop function public.test_try_teacher_submit(uuid,uuid);
drop function public.test_try_archive(uuid,uuid);
drop function public.test_try_start(uuid,uuid);
drop function public.test_try_reset(uuid,uuid);
drop function public.test_try_save(uuid,uuid);
drop function public.test_try_regrade(uuid,uuid);
drop function public.test_try_delete(uuid,uuid);
drop function public.test_try_edit(uuid,timestamptz,uuid);

delete from public.admin_audit_events where target_id::text like 'c%';
delete from public.answer_key_corrections where exam_id::text like 'c%';
delete from public.exam_retake_grants where exam_id::text like 'c%';
delete from public.answer_results where answer_id::text like 'c%';
delete from public.answers where id::text like 'c%';
delete from public.section_attempts where id::text like 'c%';
update public.exam_attempts set superseded_by=null,superseded_at=null where id::text like 'c%';
delete from public.exam_attempts where id::text like 'c%' or exam_id::text like 'c%';
delete from public.question_keys where question_id::text like 'c%';
delete from public.questions where id::text like 'c%';
delete from public.exam_sections where id::text like 'c%';
delete from public.exams where id::text like 'c%';
