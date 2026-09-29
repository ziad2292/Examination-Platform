begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

insert into public.exams(id,title,status,scheduled_start_at,scheduled_end_at,published_at,created_by) values
('d0000000-0000-4000-8000-000000000001','Closed reopen fixture','closed',now()-interval '1 hour',now()+interval '2 hours',now()-interval '1 day','10000000-0000-0000-0000-000000000001'),
('d0000000-0000-4000-8000-000000000002','Reschedule precision fixture','published',now()-interval '1 hour 17 seconds',now()+interval '2 hours',now(),'10000000-0000-0000-0000-000000000001'),
('d0000000-0000-4000-8000-000000000003','Safe delete fixture','closed',now()-interval '3 hours',now()-interval '2 hours',now()-interval '1 day','10000000-0000-0000-0000-000000000001'),
('d0000000-0000-4000-8000-000000000004','Active delete fixture','published',now()-interval '1 hour',now()+interval '1 hour',now(),'10000000-0000-0000-0000-000000000001'),
('d0000000-0000-4000-8000-000000000005','Upcoming start fixture','published',now()+interval '1 hour',now()+interval '2 hours',now(),'10000000-0000-0000-0000-000000000001'),
('d0000000-0000-4000-8000-000000000006','Closed start fixture','closed',now()-interval '2 hours',now()+interval '1 hour',now(),'10000000-0000-0000-0000-000000000001'),
('d0000000-0000-4000-8000-000000000007','Code start fixture','published',now()-interval '1 hour',now()+interval '1 hour',now(),'10000000-0000-0000-0000-000000000001'),
('d0000000-0000-4000-8000-000000000008','Retake start fixture','published',now()-interval '1 hour',now()+interval '1 hour',now(),'10000000-0000-0000-0000-000000000001'),
('d0000000-0000-4000-8000-000000000009','Numeric section fixture','draft',now()+interval '1 hour',now()+interval '2 hours',null,'10000000-0000-0000-0000-000000000001');
insert into public.exam_sections(id,exam_id,title,section_type,section_order,duration_seconds) values
('d1000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001','Module','module',1,600);
insert into public.questions(id,section_id,question_order,optional_text,option_a,option_b,option_c,option_d) values
('d2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001',1,'Question','A','B','C','D');
insert into public.question_keys(question_id,correct_option) values('d2000000-0000-4000-8000-000000000001','A');
insert into public.exam_access_codes(exam_id,access_code) values('d0000000-0000-4000-8000-000000000007','VALID');
update public.exams set access_code_required = true where id = 'd0000000-0000-4000-8000-000000000007';
insert into public.exam_attempts(id,exam_id,student_id,status,completed_at,raw_score,total_questions) values
('d3000000-0000-4000-8000-000000000002','d0000000-0000-4000-8000-000000000002','20000000-0000-0000-0000-000000000002','completed',now(),0,0),
('d3000000-0000-4000-8000-000000000008','d0000000-0000-4000-8000-000000000008','20000000-0000-0000-0000-000000000001','completed',now(),0,0);

set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.publish_exam('d0000000-0000-4000-8000-000000000001','d9000000-0000-4000-8000-000000000001')$$,'closed exam can be reopened when its schedule remains valid');
select is((select status::text from public.exams where id='d0000000-0000-4000-8000-000000000001'),'published','reopen changes status to published');
select lives_ok($$select public.reschedule_exam('d0000000-0000-4000-8000-000000000002',date_trunc('minute',(select scheduled_start_at from public.exams where id='d0000000-0000-4000-8000-000000000002')),now()+interval '3 hours',false,(select updated_at from public.exams where id='d0000000-0000-4000-8000-000000000002'),'','d9000000-0000-4000-8000-000000000002')$$,'reschedule preserves the exact opening time after attempts exist');
select lives_ok($$select public.delete_exam('d0000000-0000-4000-8000-000000000003','Safe delete fixture','Safe cleanup','d9000000-0000-4000-8000-000000000003')$$,'inactive exam without attempts can be deleted');
select throws_ok($$select public.delete_exam('d0000000-0000-4000-8000-000000000004','Active delete fixture','Unsafe cleanup','d9000000-0000-4000-8000-000000000004')$$,'P0001','An active exam cannot be deleted','currently active exam cannot be deleted');
select lives_ok($$select public.create_section('d0000000-0000-4000-8000-000000000009','2','module',600)$$,'numeric-only section names are accepted');

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select throws_ok($$select public.start_exam('d0000000-0000-4000-8000-000000000005',null)$$,'P0001','Exam has not started','student receives a specific upcoming-exam reason');
select throws_ok($$select public.start_exam('d0000000-0000-4000-8000-000000000006',null)$$,'P0001','Exam is closed','student receives a specific closed-exam reason');
select throws_ok($$select public.start_exam('d0000000-0000-4000-8000-000000000007','WRONG')$$,'P0001','Invalid access code','student receives a specific access-code reason');
select throws_ok($$select public.start_exam('d0000000-0000-4000-8000-000000000008',null)$$,'P0001','Retake authorization required','completed attempt requires an explicit retake grant');

select * from finish();
rollback;
