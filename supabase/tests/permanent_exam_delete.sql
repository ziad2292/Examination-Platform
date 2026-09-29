begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

update public.profiles set role='teacher' where id='20000000-0000-0000-0000-000000000005';
insert into public.exams(id,title,status,scheduled_start_at,scheduled_end_at,published_at,created_by) values
  ('e0000000-0000-4000-8000-000000000001','Delete complete graph','closed',now()-interval '2 hours',now()-interval '1 hour',now()-interval '1 day','10000000-0000-0000-0000-000000000001'),
  ('e0000000-0000-4000-8000-000000000002','Unrelated exam','closed',now()-interval '2 hours',now()-interval '1 hour',now()-interval '1 day','10000000-0000-0000-0000-000000000001'),
  ('e0000000-0000-4000-8000-000000000003','Other teacher exam','closed',now()-interval '2 hours',now()-interval '1 hour',now()-interval '1 day','20000000-0000-0000-0000-000000000005'),
  ('e0000000-0000-4000-8000-000000000004','Published exam','published',now()+interval '1 hour',now()+interval '2 hours',now(),'10000000-0000-0000-0000-000000000001'),
  ('e0000000-0000-4000-8000-000000000005','Closed active attempt','closed',now()-interval '2 hours',now()+interval '1 hour',now(),'10000000-0000-0000-0000-000000000001');
insert into public.exam_sections(id,exam_id,title,section_type,section_order,duration_seconds) values
  ('e1000000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000001','Module','module',1,600),
  ('e1000000-0000-4000-8000-000000000002','e0000000-0000-4000-8000-000000000002','Module','module',1,600);
insert into public.questions(id,section_id,question_order,image_path,option_a,option_b,option_c,option_d) values
  ('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001',1,'e0000000-0000-4000-8000-000000000001/question.png','A','B','C','D'),
  ('e2000000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000002',1,'e0000000-0000-4000-8000-000000000002/question.png','A','B','C','D');
insert into public.question_keys(question_id,correct_option) values
  ('e2000000-0000-4000-8000-000000000001','A'),('e2000000-0000-4000-8000-000000000002','A');
insert into public.question_import_batches(id,section_id,exam_id,created_by,status,question_count,completed_at) values
  ('e8000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000001','10000000-0000-0000-0000-000000000001','completed',1,now());
insert into public.question_import_items(batch_id,question_id,item_order,image_path,original_filename,content_sha256) values
  ('e8000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001',1,'e0000000-0000-4000-8000-000000000001/question.png','question.png',repeat('a',64));
insert into public.exam_attempts(id,exam_id,student_id,status,completed_at,raw_score,total_questions) values
  ('e3000000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000001','20000000-0000-0000-0000-000000000001','completed',now(),1,1),
  ('e3000000-0000-4000-8000-000000000002','e0000000-0000-4000-8000-000000000002','20000000-0000-0000-0000-000000000002','completed',now(),1,1),
  ('e3000000-0000-4000-8000-000000000005','e0000000-0000-4000-8000-000000000005','20000000-0000-0000-0000-000000000003','in_progress',null,null,null);
insert into public.section_attempts(id,exam_attempt_id,section_id,expires_at,status,submitted_at) values
  ('e4000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001',now()+interval '10 minutes','submitted',now()),
  ('e4000000-0000-4000-8000-000000000002','e3000000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000002',now()+interval '10 minutes','submitted',now());
insert into public.answers(id,exam_attempt_id,section_attempt_id,question_id,selected_option,client_revision,answered_at) values
  ('e5000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001','e4000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','A',1,now()),
  ('e5000000-0000-4000-8000-000000000002','e3000000-0000-4000-8000-000000000002','e4000000-0000-4000-8000-000000000002','e2000000-0000-4000-8000-000000000002','A',1,now());
insert into public.answer_results(answer_id,is_correct) values
  ('e5000000-0000-4000-8000-000000000001',true),('e5000000-0000-4000-8000-000000000002',true);
insert into public.exam_retake_grants(id,exam_id,student_id,source_attempt_id,authorized_by,reason,operation_key) values
  ('e6000000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000001','20000000-0000-0000-0000-000000000001','e3000000-0000-4000-8000-000000000001','10000000-0000-0000-0000-000000000001','Delete fixture grant','e9000000-0000-4000-8000-000000000001');
insert into public.answer_key_corrections(id,exam_id,question_id,previous_option,corrected_option,reason,corrected_by,operation_key,affected_attempts) values
  ('e7000000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','B','A','Delete fixture correction','10000000-0000-0000-0000-000000000001','e9000000-0000-4000-8000-000000000002',1);
insert into public.admin_audit_events(actor_id,action,target_type,target_id,exam_id,reason) values
  ('10000000-0000-0000-0000-000000000001','exam.fixture_event','exam','e0000000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000001','Delete fixture audit');
insert into storage.objects(bucket_id,name,owner,owner_id,metadata) values
  ('question-images','e0000000-0000-4000-8000-000000000001/question.png','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','{"mimetype":"image/png","size":10}'),
  ('question-images','e0000000-0000-4000-8000-000000000002/question.png','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','{"mimetype":"image/png","size":10}');

set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select throws_ok($$select public.delete_exam('e0000000-0000-4000-8000-000000000001','DELETE Delete complete graph','Unauthorized','e9000000-0000-4000-8000-000000000010')$$,'P0001','Exam not found','a non-owner cannot delete an exam');

select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select throws_ok($$select public.delete_exam('e0000000-0000-4000-8000-000000000004','DELETE Published exam','Unsafe','e9000000-0000-4000-8000-000000000011')$$,'P0001','An active exam cannot be deleted; close it first','a published exam cannot be deleted');
select throws_ok($$select public.delete_exam('e0000000-0000-4000-8000-000000000005','DELETE Closed active attempt','Unsafe','e9000000-0000-4000-8000-000000000012')$$,'P0001','An active exam cannot be deleted; close it first','a closed exam with an active attempt cannot be deleted');
select lives_ok($$select public.delete_exam('e0000000-0000-4000-8000-000000000001','DELETE Delete complete graph','Owner requested irreversible deletion','e9000000-0000-4000-8000-000000000013')$$,'a closed exam with historical results can be permanently deleted');
select is((select count(*)::integer from public.exams where id='e0000000-0000-4000-8000-000000000001'),0,'exam is removed');
select is((select count(*)::integer from public.exam_attempts where exam_id='e0000000-0000-4000-8000-000000000001'),0,'attempts are removed');
select is((select count(*)::integer from public.answers where exam_attempt_id='e3000000-0000-4000-8000-000000000001'),0,'answers are removed');
select is((select count(*)::integer from public.answer_results where answer_id='e5000000-0000-4000-8000-000000000001'),0,'grading results are removed');
select is((select count(*)::integer from public.answer_key_corrections where exam_id='e0000000-0000-4000-8000-000000000001'),0,'answer-key corrections are removed');
select is((select count(*)::integer from public.question_import_batches where exam_id='e0000000-0000-4000-8000-000000000001'),0,'question import history is removed');
select is((select count(*)::integer from public.storage_cleanup_jobs where exam_id='e0000000-0000-4000-8000-000000000001'),1,'question image is queued for post-commit Storage cleanup');
select is((select count(*)::integer from public.admin_audit_events where action='exam.permanently_deleted' and target_id='e0000000-0000-4000-8000-000000000001'),1,'a retained deletion tombstone records the actor and impact');
select is((select count(*)::integer from public.exam_attempts where exam_id='e0000000-0000-4000-8000-000000000002'),1,'unrelated exam results remain untouched');
select is((select count(*)::integer from storage.objects where name='e0000000-0000-4000-8000-000000000002/question.png'),1,'unrelated Storage objects remain untouched');

select * from finish();
rollback;
