begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select extensions.plan(6);

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  confirmation_token,recovery_token,email_change_token_new,email_change,email_change_token_current,
  phone_change,phone_change_token,reauthentication_token,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
select '00000000-0000-0000-0000-000000000000',id,'authenticated','authenticated',email,
  crypt('Disposable123!',gen_salt('bf')),now(),'','','','','','','','',now(),now(),
  '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb
from (values
  ('f2000000-0000-4000-8000-000000000001'::uuid,'progress-teacher@example.invalid'),
  ('f2000000-0000-4000-8000-000000000002'::uuid,'progress-student1@example.invalid'),
  ('f2000000-0000-4000-8000-000000000003'::uuid,'progress-student2@example.invalid')
) users(id,email);
insert into public.profiles(id,full_name,email,role) values
  ('f2000000-0000-4000-8000-000000000001','Progress Teacher','progress-teacher@example.invalid','teacher'),
  ('f2000000-0000-4000-8000-000000000002','Progress Student One','progress-student1@example.invalid','student'),
  ('f2000000-0000-4000-8000-000000000003','Progress Student Two','progress-student2@example.invalid','student');

insert into public.exams(id,title,status,scheduled_start_at,scheduled_end_at,created_by,show_results_to_students)
values('f1000000-0000-4000-8000-000000000001','Progress fixture','published',now()-interval '1 hour',now()+interval '1 hour','f2000000-0000-4000-8000-000000000001',false);
insert into public.exam_sections(id,exam_id,title,section_type,section_order,duration_seconds)
values('f1000000-0000-4000-8000-000000000002','f1000000-0000-4000-8000-000000000001','Questions','module',1,600);
insert into public.questions(id,section_id,question_order,optional_text,option_a,option_b,option_c,option_d)
values('f1000000-0000-4000-8000-000000000003','f1000000-0000-4000-8000-000000000002',1,'Fixture question','A','B','C','D');
insert into public.exam_attempts(id,exam_id,student_id)
values('f1000000-0000-4000-8000-000000000004','f1000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000002');

select extensions.has_function('public','student_attempt_progress',array['uuid'],'progress RPC exists');
set local role authenticated;
select set_config('request.jwt.claim.sub','f2000000-0000-4000-8000-000000000002',true);
select extensions.is(public.student_attempt_progress('f1000000-0000-4000-8000-000000000004')->>'exam_title','Progress fixture','owner receives exam title');
select extensions.is((public.student_attempt_progress('f1000000-0000-4000-8000-000000000004')->'sections'->0->>'question_count')::integer,1,'owner receives question count');
select extensions.is(public.student_attempt_progress('f1000000-0000-4000-8000-000000000004')->>'raw_score',null::text,'hidden marks remain masked');
select set_config('request.jwt.claim.sub','f2000000-0000-4000-8000-000000000003',true);
select extensions.is(public.student_attempt_progress('f1000000-0000-4000-8000-000000000004'),null::jsonb,'another student receives no attempt');
reset role;
set local role anon;
select extensions.throws_ok($$select public.student_attempt_progress('f1000000-0000-4000-8000-000000000004')$$,'42501','permission denied for function student_attempt_progress','anonymous requests cannot invoke progress RPC');

select * from extensions.finish();
rollback;
