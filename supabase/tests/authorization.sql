begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(22);

insert into public.exams(id,title,status,scheduled_start_at,scheduled_end_at,published_at,created_by)
values('90000000-0000-0000-0000-000000000001','RLS fixture','published',now()-interval '1 hour',now()+interval '1 hour',now(),'10000000-0000-0000-0000-000000000001');
insert into public.exam_sections(id,exam_id,title,section_type,section_order,duration_seconds)
values('91000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000001','Module','module',1,600);
insert into public.questions(id,section_id,question_order,optional_text,option_a,option_b,option_c,option_d)
values('92000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000001',1,'Fixture?','A','B','C','D');
insert into public.question_keys(question_id,correct_option)
values('92000000-0000-0000-0000-000000000001','A');
insert into public.exam_attempts(id,exam_id,student_id)
values
  ('93000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001'),
  ('93000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002');
insert into public.section_attempts(id,exam_attempt_id,section_id,expires_at)
values
  ('94000000-0000-0000-0000-000000000001','93000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000001',now()+interval '10 minutes'),
  ('94000000-0000-0000-0000-000000000002','93000000-0000-0000-0000-000000000002','91000000-0000-0000-0000-000000000001',now()+interval '10 minutes');
insert into public.answers(id,exam_attempt_id,section_attempt_id,question_id,selected_option)
values
  ('95000000-0000-0000-0000-000000000001','93000000-0000-0000-0000-000000000001','94000000-0000-0000-0000-000000000001','92000000-0000-0000-0000-000000000001','A'),
  ('95000000-0000-0000-0000-000000000002','93000000-0000-0000-0000-000000000002','94000000-0000-0000-0000-000000000002','92000000-0000-0000-0000-000000000001','B');

set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is((select count(*)::integer from public.exam_attempts where exam_id='90000000-0000-0000-0000-000000000001'),1,'student sees only their fixture attempt');
select is((select count(*)::integer from public.exam_attempts where id='93000000-0000-0000-0000-000000000002'),0,'student cannot read another attempt');
select is((select count(*)::integer from public.answers where exam_attempt_id in('93000000-0000-0000-0000-000000000001','93000000-0000-0000-0000-000000000002')),1,'student sees only their fixture answer');
select is((select count(*)::integer from public.answers where id='95000000-0000-0000-0000-000000000002'),0,'student cannot read another answer');
select is((select count(*)::integer from public.question_keys),0,'student cannot read answer keys');
select is((select count(*)::integer from public.questions where id='92000000-0000-0000-0000-000000000001'),1,'student can read questions only after owning an attempt');
select throws_ok($$select public.save_answer('94000000-0000-0000-0000-000000000002','92000000-0000-0000-0000-000000000001','A',false,2)$$,'P0001','Section is closed','student cannot modify another answer');
select throws_ok($$select public.start_section('93000000-0000-0000-0000-000000000002','91000000-0000-0000-0000-000000000001')$$,'P0001','Attempt is not active','student cannot start another attempt section');
select results_eq($$delete from public.exam_attempts where id='93000000-0000-0000-0000-000000000001' returning id$$,$$select id from public.exam_attempts where false$$,'student cannot delete attempts');
select throws_ok($$insert into public.exams(title,status,scheduled_start_at,scheduled_end_at,created_by) values('Forged','draft',now(),now()+interval '1 hour','20000000-0000-0000-0000-000000000001')$$,'42501','new row violates row-level security policy for table "exams"','student cannot create exams');

reset role;
set local role anon;
select set_config('request.jwt.claim.sub','',true);
select is((select count(*)::integer from public.exams),0,'anonymous user cannot read exams');
select is((select count(*)::integer from public.exam_sections),0,'anonymous user cannot read sections');
select is((select count(*)::integer from public.questions),0,'anonymous user cannot read questions');
select is((select count(*)::integer from public.exam_attempts),0,'anonymous user cannot read attempts');
select throws_ok($$select public.start_exam('90000000-0000-0000-0000-000000000001',null)$$,'42501','permission denied for function start_exam','anonymous user cannot execute transition RPCs');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select is((select count(*)::integer from public.exam_attempts where exam_id='90000000-0000-0000-0000-000000000001'),2,'owning teacher can read exam attempts');
select is((select count(*)::integer from public.answers where exam_attempt_id in('93000000-0000-0000-0000-000000000001','93000000-0000-0000-0000-000000000002')),2,'owning teacher can read responses');
select is((select count(*)::integer from public.question_keys where question_id='92000000-0000-0000-0000-000000000001'),1,'owning teacher can read answer keys');
select throws_ok($$select public.save_answer('94000000-0000-0000-0000-000000000001','92000000-0000-0000-0000-000000000001','D',false,3)$$,'P0001','Section is closed','teacher cannot answer for a student');

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is((select count(*)::integer from public.exam_attempts where exam_id='90000000-0000-0000-0000-000000000001'),1,'student B sees their own fixture attempt');
select is((select count(*)::integer from public.exam_attempts where id='93000000-0000-0000-0000-000000000001'),0,'student B cannot read student A attempt');

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select is((select count(*)::integer from public.questions where id='92000000-0000-0000-0000-000000000001'),0,'student without an attempt cannot retrieve exam questions');

select * from finish();
rollback;
