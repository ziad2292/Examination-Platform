begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

-- Promote a second seeded account to teacher for cross-owner authorization checks.
update public.profiles set role='teacher' where id='20000000-0000-0000-0000-000000000005';

insert into public.exams(id,title,description,status,scheduled_start_at,scheduled_end_at,created_by)
values('b0000000-0000-0000-0000-000000000001','Administration fixture','Original','draft',now()-interval '1 hour',now()+interval '2 hours','10000000-0000-0000-0000-000000000001');
insert into public.exam_sections(id,exam_id,title,section_type,section_order,duration_seconds) values
  ('b1000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001','Reading','module',1,600),
  ('b1000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-000000000001','Break','break',2,300),
  ('b1000000-0000-0000-0000-000000000003','b0000000-0000-0000-0000-000000000001','Math','module',3,600);
insert into storage.objects(bucket_id,name,owner,owner_id,metadata) values
  ('question-images','b0000000-0000-0000-0000-000000000001/q1.png','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','{"mimetype":"image/png","size":10}'),
  ('question-images','b0000000-0000-0000-0000-000000000001/q2.png','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','{"mimetype":"image/png","size":10}');
insert into public.questions(id,section_id,question_order,image_path,optional_text,option_a,option_b,option_c,option_d) values
  ('b2000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001',1,'b0000000-0000-0000-0000-000000000001/q1.png',null,'A','B','C','D'),
  ('b2000000-0000-0000-0000-000000000002','b1000000-0000-0000-0000-000000000003',1,'b0000000-0000-0000-0000-000000000001/q2.png',null,'A','B','C','D');
insert into public.question_keys(question_id,correct_option) values
  ('b2000000-0000-0000-0000-000000000001','A'),
  ('b2000000-0000-0000-0000-000000000002','B');

set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select ok((public.exam_publish_validation('b0000000-0000-0000-0000-000000000001')->>'ready')::boolean,'valid exam passes full publish validation');
select is((public.exam_publish_validation('b0000000-0000-0000-0000-000000000001')->>'modules')::integer,2,'publish summary counts modules');
select lives_ok($$select public.update_exam_metadata('b0000000-0000-0000-0000-000000000001','Edited administration fixture','Updated description','Read carefully',
  (select scheduled_start_at from public.exams where id='b0000000-0000-0000-0000-000000000001'),
  (select scheduled_end_at from public.exams where id='b0000000-0000-0000-0000-000000000001'),
  (select updated_at from public.exams where id='b0000000-0000-0000-0000-000000000001'),
  'Initial metadata edit','b9000000-0000-4000-8000-000000000001')$$,'valid draft metadata edit succeeds');
select is((select title from public.exams where id='b0000000-0000-0000-0000-000000000001'),'Edited administration fixture','draft title is updated');
select throws_ok($$select public.update_exam_metadata('b0000000-0000-0000-0000-000000000001','Edited administration fixture','','',now()+interval '2 hours',now()+interval '1 hour',
  (select updated_at from public.exams where id='b0000000-0000-0000-0000-000000000001'),'Bad schedule','b9000000-0000-4000-8000-000000000002')$$,'P0001','Closing time must be after opening time','invalid schedule is rejected server-side');
select lives_ok($$select public.publish_exam('b0000000-0000-0000-0000-000000000001','b9000000-0000-4000-8000-000000000003')$$,'valid exam publishes through audited RPC');

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select throws_ok($$select public.update_exam_metadata('b0000000-0000-0000-0000-000000000001','Unauthorized edit','','',
  (select scheduled_start_at from public.exams where id='b0000000-0000-0000-0000-000000000001'),
  (select scheduled_end_at from public.exams where id='b0000000-0000-0000-0000-000000000001'),
  (select updated_at from public.exams where id='b0000000-0000-0000-0000-000000000001'),'Cross-owner edit','b9000000-0000-4000-8000-000000000099')$$,'P0001','Exam not found','non-owning teacher cannot edit exam metadata');

set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.start_exam('b0000000-0000-0000-0000-000000000001',null)$$,'student starts administration fixture');
select lives_ok($$select public.start_section((select id from public.exam_attempts where exam_id='b0000000-0000-0000-0000-000000000001' and student_id=auth.uid()),'b1000000-0000-0000-0000-000000000001')$$,'student starts first section');
create temporary table saved_expiry as select expires_at from public.section_attempts where section_id='b1000000-0000-0000-0000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.update_exam_metadata('b0000000-0000-0000-0000-000000000001','Renamed after start','Safe description','Safe instructions',
  (select scheduled_start_at from public.exams where id='b0000000-0000-0000-0000-000000000001'),
  (select scheduled_end_at from public.exams where id='b0000000-0000-0000-0000-000000000001'),
  (select updated_at from public.exams where id='b0000000-0000-0000-0000-000000000001'),'Safe descriptive change','b9000000-0000-4000-8000-000000000004')$$,'descriptive metadata remains editable after attempts exist');
select is((select title from public.exams where id='b0000000-0000-0000-0000-000000000001'),'Renamed after start','safe post-attempt metadata changed');
select throws_ok($$select public.update_exam_metadata('b0000000-0000-0000-0000-000000000001','Renamed after start','','',
  (select scheduled_start_at+interval '1 minute' from public.exams where id='b0000000-0000-0000-0000-000000000001'),
  (select scheduled_end_at from public.exams where id='b0000000-0000-0000-0000-000000000001'),
  (select updated_at from public.exams where id='b0000000-0000-0000-0000-000000000001'),'Unsafe schedule edit','b9000000-0000-4000-8000-000000000005')$$,'P0001','Use the audited reschedule workflow after attempts exist','normal metadata edit cannot bypass post-attempt schedule policy');
select throws_ok($$select public.reschedule_exam('b0000000-0000-0000-0000-000000000001',
  (select scheduled_start_at+interval '1 minute' from public.exams where id='b0000000-0000-0000-0000-000000000001'),
  (select scheduled_end_at+interval '1 hour' from public.exams where id='b0000000-0000-0000-0000-000000000001'),false,
  (select updated_at from public.exams where id='b0000000-0000-0000-0000-000000000001'),'Move opening','b9000000-0000-4000-8000-000000000006')$$,'P0001','Opening time is locked after attempts exist','opening time cannot move after attempts exist');
select lives_ok($$select public.reschedule_exam('b0000000-0000-0000-0000-000000000001',
  (select scheduled_start_at from public.exams where id='b0000000-0000-0000-0000-000000000001'),
  (select scheduled_end_at+interval '1 hour' from public.exams where id='b0000000-0000-0000-0000-000000000001'),false,
  (select updated_at from public.exams where id='b0000000-0000-0000-0000-000000000001'),'Extend closing','b9000000-0000-4000-8000-000000000007')$$,'closing time can be extended after attempts exist');
select is((select expires_at from public.section_attempts where section_id='b1000000-0000-0000-0000-000000000001'),(select expires_at from saved_expiry),'rescheduling does not recalculate an active section expiry');
select throws_ok($$select public.archive_exam('b0000000-0000-0000-0000-000000000001','Too early','b9000000-0000-4000-8000-000000000008')$$,'P0001','Cannot archive an exam with active attempts','archive rejects active attempts');

select lives_ok($$select public.teacher_submit_section((select id from public.section_attempts where section_id='b1000000-0000-0000-0000-000000000001'),'Administrative section submit','b9000000-0000-4000-8000-000000000009')$$,'teacher can manually submit an active section');
select lives_ok($$select public.teacher_submit_section((select id from public.section_attempts where section_id='b1000000-0000-0000-0000-000000000001'),'Administrative section submit','b9000000-0000-4000-8000-000000000009')$$,'duplicate manual section submit is idempotent');
select is((select count(*)::integer from public.admin_audit_events where action='attempt.section_submitted' and idempotency_key='b9000000-0000-4000-8000-000000000009'),1,'manual section submit produces one audit event');

select lives_ok($$select public.reset_attempt((select id from public.exam_attempts where exam_id='b0000000-0000-0000-0000-000000000001' and generation=1),'Student needs a clean retry','b9000000-0000-4000-8000-000000000010')$$,'active attempt reset succeeds');
select is((select status::text from public.exam_attempts where exam_id='b0000000-0000-0000-0000-000000000001' and generation=1),'expired','reset preserves old attempt as terminal history');
select is((select count(*)::integer from public.exam_retake_grants where exam_id='b0000000-0000-0000-0000-000000000001' and consumed_at is null),1,'reset creates one open retake grant');
select lives_ok($$select public.reset_attempt((select id from public.exam_attempts where exam_id='b0000000-0000-0000-0000-000000000001' and generation=1),'Student needs a clean retry','b9000000-0000-4000-8000-000000000010')$$,'duplicate reset request is idempotent');
select is((select count(*)::integer from public.admin_audit_events where action='attempt.reset' and idempotency_key='b9000000-0000-4000-8000-000000000010'),1,'duplicate reset produces one audit event');

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select throws_ok($$select public.reset_attempt((select id from public.exam_attempts where exam_id='b0000000-0000-0000-0000-000000000001' and generation=1),'Cross-owner reset','b9000000-0000-4000-8000-000000000011')$$,'P0001','Attempt not found','non-owning teacher cannot reset an attempt');

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.start_exam('b0000000-0000-0000-0000-000000000001',null)$$,'authorized retake starts');
select is((select max(generation) from public.exam_attempts where exam_id='b0000000-0000-0000-0000-000000000001' and student_id=auth.uid()),2,'retake creates a new generation');
select is((select count(*)::integer from public.exam_attempts where exam_id='b0000000-0000-0000-0000-000000000001' and student_id=auth.uid()),2,'historical attempt remains intact');
select ok((select superseded_by is not null from public.exam_attempts where exam_id='b0000000-0000-0000-0000-000000000001' and generation=1),'old attempt records its successor');
select lives_ok($$select public.start_section((select id from public.exam_attempts where exam_id='b0000000-0000-0000-0000-000000000001' and generation=2),'b1000000-0000-0000-0000-000000000001')$$,'retake section starts');
select lives_ok($$select public.save_answer((select id from public.section_attempts where exam_attempt_id=(select id from public.exam_attempts where exam_id='b0000000-0000-0000-0000-000000000001' and generation=2)),'b2000000-0000-0000-0000-000000000001','A',false,1)$$,'retake answer saves');

select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.teacher_submit_attempt((select id from public.exam_attempts where exam_id='b0000000-0000-0000-0000-000000000001' and generation=2),'Class ended','b9000000-0000-4000-8000-000000000012')$$,'teacher can manually submit whole attempt');
select lives_ok($$select public.teacher_submit_attempt((select id from public.exam_attempts where exam_id='b0000000-0000-0000-0000-000000000001' and generation=2),'Class ended','b9000000-0000-4000-8000-000000000012')$$,'duplicate whole-attempt submit is idempotent');
select results_eq($$select status::text,raw_score,total_questions from public.exam_attempts where exam_id='b0000000-0000-0000-0000-000000000001' and generation=2$$,$$select 'completed'::text,1::integer,2::integer$$,'manual submit locks and grades the full exam deterministically');
select is((select count(*)::integer from public.admin_audit_events where action='attempt.manually_submitted' and idempotency_key='b9000000-0000-4000-8000-000000000012'),1,'duplicate attempt submit produces one audit event');

select lives_ok($$select public.correct_answer_key('b2000000-0000-0000-0000-000000000001','B','Original key was incorrect','b9000000-0000-4000-8000-000000000013')$$,'explicit answer-key correction succeeds');
select is((select correct_option::text from public.question_keys where question_id='b2000000-0000-0000-0000-000000000001'),'B','corrected key is stored');
select is((select raw_score from public.exam_attempts where exam_id='b0000000-0000-0000-0000-000000000001' and generation=2),0,'terminal attempt is regraded from source answers');
select results_eq($$select previous_option::text,corrected_option::text,affected_attempts from public.answer_key_corrections where operation_key='b9000000-0000-4000-8000-000000000013'$$,$$select 'A'::text,'B'::text,2::integer$$,'correction preserves old key and affected-attempt count');
select lives_ok($$select public.correct_answer_key('b2000000-0000-0000-0000-000000000001','B','Original key was incorrect','b9000000-0000-4000-8000-000000000013')$$,'duplicate regrade request is deterministic');
select is((select count(*)::integer from public.admin_audit_events where action='question.answer_key_corrected' and idempotency_key='b9000000-0000-4000-8000-000000000013'),1,'answer-key correction has one audit event');

select lives_ok($$select public.authorize_attempt_retake((select id from public.exam_attempts where exam_id='b0000000-0000-0000-0000-000000000001' and generation=2),'Approved second retake','b9000000-0000-4000-8000-000000000014')$$,'terminal attempt can receive a retake grant');
select lives_ok($$select public.authorize_attempt_retake((select id from public.exam_attempts where exam_id='b0000000-0000-0000-0000-000000000001' and generation=2),'Approved second retake','b9000000-0000-4000-8000-000000000014')$$,'duplicate retake authorization is idempotent');
select is((select count(*)::integer from public.exam_retake_grants where exam_id='b0000000-0000-0000-0000-000000000001' and consumed_at is null),1,'only one open retake grant exists');

select lives_ok($$select public.archive_exam('b0000000-0000-0000-0000-000000000001','Retired exam','b9000000-0000-4000-8000-000000000015')$$,'exam without active attempts archives');
select is((select status::text from public.exams where id='b0000000-0000-0000-0000-000000000001'),'archived','archived status is stored');
select lives_ok($$select public.restore_exam('b0000000-0000-0000-0000-000000000001','Needed for review','b9000000-0000-4000-8000-000000000016')$$,'archived exam can be deliberately restored');
select is((select status::text from public.exams where id='b0000000-0000-0000-0000-000000000001'),'closed','exam with attempts restores as closed');
select lives_ok($$select public.reschedule_exam('b0000000-0000-0000-0000-000000000001',
  (select scheduled_start_at from public.exams where id='b0000000-0000-0000-0000-000000000001'),
  (select scheduled_end_at+interval '1 hour' from public.exams where id='b0000000-0000-0000-0000-000000000001'),true,
  (select updated_at from public.exams where id='b0000000-0000-0000-0000-000000000001'),'Reopen for authorized retake','b9000000-0000-4000-8000-000000000017')$$,'closed exam reopens only through audited reschedule');
select is((select status::text from public.exams where id='b0000000-0000-0000-0000-000000000001'),'published','reopen returns exam to published');

-- Duplicate the complete structure with separately copied Storage paths.
select lives_ok($$select public.begin_exam_duplication('b0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000010','b9000000-0000-4000-8000-000000000018')$$,'duplication job begins idempotently');
reset role;
insert into storage.objects(bucket_id,name,owner,owner_id,metadata) values
  ('question-images','b0000000-0000-0000-0000-000000000010/q1.png','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','{"mimetype":"image/png","size":10}'),
  ('question-images','b0000000-0000-0000-0000-000000000010/q2.png','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','{"mimetype":"image/png","size":10}');
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.complete_exam_duplication('b0000000-0000-0000-0000-000000000010','Administration copy',
  jsonb_build_object('b0000000-0000-0000-0000-000000000001/q1.png','b0000000-0000-0000-0000-000000000010/q1.png','b0000000-0000-0000-0000-000000000001/q2.png','b0000000-0000-0000-0000-000000000010/q2.png'),
  'b9000000-0000-4000-8000-000000000018')$$,'full exam duplication completes atomically');
select results_eq($$select status::text,(select count(*)::integer from public.exam_sections where exam_id=e.id),(select count(*)::integer from public.questions q join public.exam_sections s on s.id=q.section_id where s.exam_id=e.id),(select count(*)::integer from public.exam_attempts where exam_id=e.id) from public.exams e where id='b0000000-0000-0000-0000-000000000010'$$,$$select 'draft'::text,3::integer,2::integer,0::integer$$,'duplicate is a new editable draft with full structure and no attempts');
select is((select count(*)::integer from public.question_keys k join public.questions q on q.id=k.question_id join public.exam_sections s on s.id=q.section_id where s.exam_id='b0000000-0000-0000-0000-000000000010'),2,'answer keys are copied securely');
select is((select count(*)::integer from public.questions source_q join public.exam_sections source_s on source_s.id=source_q.section_id join public.questions copy_q on copy_q.id=source_q.id join public.exam_sections copy_s on copy_s.id=copy_q.section_id where source_s.exam_id='b0000000-0000-0000-0000-000000000001' and copy_s.exam_id='b0000000-0000-0000-0000-000000000010'),0,'duplicate uses new question identities');

-- Image replacement is retry-safe and immutable after attempts.
reset role;
insert into public.exams(id,title,status,scheduled_start_at,scheduled_end_at,created_by) values('b0000000-0000-0000-0000-000000000020','Image fixture','draft',now()+interval '1 day',now()+interval '2 days','10000000-0000-0000-0000-000000000001');
insert into public.exam_sections(id,exam_id,title,section_type,section_order,duration_seconds) values('b1000000-0000-0000-0000-000000000020','b0000000-0000-0000-0000-000000000020','Module','module',1,600);
insert into storage.objects(bucket_id,name,owner,owner_id,metadata) values
  ('question-images','b0000000-0000-0000-0000-000000000020/old.png','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','{"mimetype":"image/png","size":10}'),
  ('question-images','b0000000-0000-0000-0000-000000000020/new.png','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','{"mimetype":"image/png","size":10}');
insert into public.questions(id,section_id,question_order,image_path,option_a,option_b,option_c,option_d) values('b2000000-0000-0000-0000-000000000020','b1000000-0000-0000-0000-000000000020',1,'b0000000-0000-0000-0000-000000000020/old.png','A','B','C','D');
insert into public.question_keys(question_id,correct_option) values('b2000000-0000-0000-0000-000000000020','A');
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.replace_question_image('b2000000-0000-0000-0000-000000000020','b0000000-0000-0000-0000-000000000020/old.png','b0000000-0000-0000-0000-000000000020/new.png','Replace damaged scan','b9000000-0000-4000-8000-000000000019')$$,'editable question image replacement succeeds');
select is((select image_path from public.questions where id='b2000000-0000-0000-0000-000000000020'),'b0000000-0000-0000-0000-000000000020/new.png','database points at replacement image');
select is((select count(*)::integer from public.storage_cleanup_jobs where path='b0000000-0000-0000-0000-000000000020/old.png'),1,'old image is queued for post-commit cleanup');
select throws_ok($$select public.replace_question_image('b2000000-0000-0000-0000-000000000020','b0000000-0000-0000-0000-000000000020/stale.png','b0000000-0000-0000-0000-000000000020/old.png','Stale editor replacement','b9000000-0000-4000-8000-000000000098')$$,'P0001','Question image changed in another session','database conflict preserves the current image');
select throws_ok($$select public.replace_question_image('b2000000-0000-0000-0000-000000000020','b0000000-0000-0000-0000-000000000020/new.png','b0000000-0000-0000-0000-000000000020/missing.png','Missing object','b9000000-0000-4000-8000-000000000020')$$,'P0001','Replacement image is missing from Storage','Storage failure leaves database reference unchanged');
reset role;
insert into public.exam_attempts(exam_id,student_id) values('b0000000-0000-0000-0000-000000000020','20000000-0000-0000-0000-000000000002');
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select throws_ok($$select public.replace_question_image('b2000000-0000-0000-0000-000000000020','b0000000-0000-0000-0000-000000000020/new.png','b0000000-0000-0000-0000-000000000020/old.png','Historical rewrite','b9000000-0000-4000-8000-000000000021')$$,'P0001','Question images are immutable after attempts exist','historical image replacement is rejected');

-- Hard delete is limited to untouched drafts and queues images safely.
insert into public.exams(id,title,status,scheduled_start_at,scheduled_end_at,created_by) values('b0000000-0000-0000-0000-000000000030','Disposable draft','draft',now()+interval '1 day',now()+interval '2 days','10000000-0000-0000-0000-000000000001');
select lives_ok($$select public.delete_exam('b0000000-0000-0000-0000-000000000030','Disposable draft','No longer needed','b9000000-0000-4000-8000-000000000022')$$,'untouched draft can be permanently deleted');
select is((select count(*)::integer from public.exams where id='b0000000-0000-0000-0000-000000000030'),0,'hard delete removes the draft');
insert into public.exams(id,title,status,scheduled_start_at,scheduled_end_at,created_by) values('b0000000-0000-0000-0000-000000000031','Draft with history','draft',now()+interval '1 day',now()+interval '2 days','10000000-0000-0000-0000-000000000001');
reset role;
insert into public.exam_attempts(exam_id,student_id) values('b0000000-0000-0000-0000-000000000031','20000000-0000-0000-0000-000000000003');
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select throws_ok($$select public.delete_exam('b0000000-0000-0000-0000-000000000031','Draft with history','Unsafe delete','b9000000-0000-4000-8000-000000000023')$$,'P0001','Exams with attempts must be archived, not deleted','hard delete preserves attempts and results');

-- Validation reports distinct production blockers.
reset role;
insert into public.exams(id,title,status,scheduled_start_at,scheduled_end_at,created_by) values
  ('b0000000-0000-0000-0000-000000000040','Empty fixture','draft',now()+interval '1 day',now()+interval '2 days','10000000-0000-0000-0000-000000000001'),
  ('b0000000-0000-0000-0000-000000000041','Past fixture','draft',now()-interval '2 days',now()-interval '1 day','10000000-0000-0000-0000-000000000001');
select ok(not (public.exam_publish_validation('b0000000-0000-0000-0000-000000000040')->>'ready')::boolean,'empty exam fails publish validation');
select ok((public.exam_publish_validation('b0000000-0000-0000-0000-000000000041')->'errors') ? 'Exam closing time must be in the future.','past schedule is reported');
insert into public.exam_sections(id,exam_id,title,section_type,section_order,duration_seconds) values('b1000000-0000-0000-0000-000000000040','b0000000-0000-0000-0000-000000000040','Empty module','module',1,600);
select ok((public.exam_publish_validation('b0000000-0000-0000-0000-000000000040')->'errors') ? 'Every module must contain at least one question.','empty module is reported');
insert into public.questions(id,section_id,question_order,image_path,option_a,option_b,option_c,option_d) values('b2000000-0000-0000-0000-000000000040','b1000000-0000-0000-0000-000000000040',1,'b0000000-0000-0000-0000-000000000040/missing.png','A','B','C','D');
select ok((public.exam_publish_validation('b0000000-0000-0000-0000-000000000040')->'errors') ? 'Every question needs an answer key.','missing key is reported');
insert into public.question_keys(question_id,correct_option) values('b2000000-0000-0000-0000-000000000040','A');
select ok((public.exam_publish_validation('b0000000-0000-0000-0000-000000000040')->'errors') ? 'One or more question images are missing from Storage.','missing Storage object is reported');

set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select is((select active_attempts::integer from public.teacher_exam_attempt_counts(array['b0000000-0000-0000-0000-000000000001']::uuid[])),0,'live status count reflects no active attempt after administration');
select ok((select count(*) from public.admin_audit_events where exam_id='b0000000-0000-0000-0000-000000000001') >= 8,'important lifecycle operations are auditable');

select * from finish();
rollback;
