begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,raw_user_meta_data) values
('ad270000-0000-4000-8000-000000000001','expand-student@example.invalid','{"assessly_registration":"student","full_name":"Expansion Student","role":"superadmin"}'),
('ad270000-0000-4000-8000-000000000002','expand-teacher-b@example.invalid','{}'),
('ad270000-0000-4000-8000-000000000003','expand-teacher-c@example.invalid','{}'),
('ad270000-0000-4000-8000-000000000004','expand-rejected@example.invalid','{"assessly_registration":"student","full_name":"Rejected Student"}');
insert into public.profiles(id,email,full_name,role) values
('ad270000-0000-4000-8000-000000000002','expand-teacher-b@example.invalid','Teacher B','teacher'),
('ad270000-0000-4000-8000-000000000003','expand-teacher-c@example.invalid','Teacher C','teacher');
select is((select role::text from public.profiles where id='ad270000-0000-4000-8000-000000000001'),'student','signup metadata cannot elevate role');
select is((select approval_status from public.profiles where id='ad270000-0000-4000-8000-000000000001'),'pending','signup starts pending');
set local role authenticated;
select set_config('request.jwt.claim.sub','ad270000-0000-4000-8000-000000000001',true);
select is(public.my_registration_status(),'pending','student can inspect own registration status');
select is(public.is_active_user(),false,'pending user fails active access gate');
select is((select count(*)::integer from public.exams),0,'pending user cannot read exams');
select throws_ok($$select public.review_student_registration('ad270000-0000-4000-8000-000000000001',true)$$,'42501','Administrator access required','student cannot self-approve');
select set_config('request.jwt.claim.sub','90000000-0000-0000-0000-000000000001',true);
select throws_ok($$select public.review_student_registration('ad270000-0000-4000-8000-000000000001',true)$$,'P0001','The student must verify their email first','approval requires verified email');
reset role;
update auth.users set email_confirmed_at=now() where id='ad270000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','90000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.review_student_registration('ad270000-0000-4000-8000-000000000001',true)$$,'verified account can be approved');
select lives_ok($$select public.review_student_registration('ad270000-0000-4000-8000-000000000001',true)$$,'approval retry is safe');
select lives_ok($$select public.review_student_registration('ad270000-0000-4000-8000-000000000004',false,'Duplicate application')$$,'administrator can reject with private note');
select is((select approval_status from public.profiles where id='ad270000-0000-4000-8000-000000000004'),'rejected','rejection persists');
select lives_ok($$select public.change_student_teacher_links(array['ad270000-0000-4000-8000-000000000001']::uuid[],'10000000-0000-0000-0000-000000000001',false)$$,'first teacher link');
select lives_ok($$select public.change_student_teacher_links(array['ad270000-0000-4000-8000-000000000001']::uuid[],'ad270000-0000-4000-8000-000000000002',false)$$,'second teacher link');
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select is((select count(*)::integer from public.profiles where id='ad270000-0000-4000-8000-000000000001'),1,'teacher A sees shared student');
select set_config('request.jwt.claim.sub','ad270000-0000-4000-8000-000000000002',true);
select is((select count(*)::integer from public.profiles where id='ad270000-0000-4000-8000-000000000001'),1,'teacher B sees shared student');
select set_config('request.jwt.claim.sub','ad270000-0000-4000-8000-000000000003',true);
select is((select count(*)::integer from public.profiles where id='ad270000-0000-4000-8000-000000000001'),0,'teacher C cannot see unlinked student');
reset role;
insert into public.exams(id,title,created_by,scheduled_start_at,scheduled_end_at) values
('ad270000-0000-4000-8000-000000000010','Expansion A','10000000-0000-0000-0000-000000000001',now()-interval '1 hour',now()+interval '1 hour'),
('ad270000-0000-4000-8000-000000000011','Expansion B','ad270000-0000-4000-8000-000000000002',now()-interval '1 hour',now()+interval '1 hour'),
('ad270000-0000-4000-8000-000000000012','Expansion Unassigned','ad270000-0000-4000-8000-000000000002',now()-interval '1 hour',now()+interval '1 hour');
insert into public.exam_sections(id,exam_id,title,section_type,section_order,duration_seconds)
values('ad270000-0000-4000-8000-000000000020','ad270000-0000-4000-8000-000000000010','Module A','module',1,600),
('ad270000-0000-4000-8000-000000000021','ad270000-0000-4000-8000-000000000011','Module B','module',1,600),
('ad270000-0000-4000-8000-000000000022','ad270000-0000-4000-8000-000000000012','Module C','module',1,600);
insert into public.questions(id,section_id,question_order,optional_text,option_a,option_b,option_c,option_d) values
('ad270000-0000-4000-8000-000000000030','ad270000-0000-4000-8000-000000000020',1,'Question one','A','B','C','D'),
('ad270000-0000-4000-8000-000000000031','ad270000-0000-4000-8000-000000000020',2,'Question two','A','B','C','D'),
('ad270000-0000-4000-8000-000000000032','ad270000-0000-4000-8000-000000000021',1,'Question B','A','B','C','D'),
('ad270000-0000-4000-8000-000000000033','ad270000-0000-4000-8000-000000000022',1,'Question C','A','B','C','D');
insert into public.question_keys(question_id,correct_option) values
('ad270000-0000-4000-8000-000000000030','B'),('ad270000-0000-4000-8000-000000000031','C'),
('ad270000-0000-4000-8000-000000000032','A'),('ad270000-0000-4000-8000-000000000033','A');
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.set_exam_randomization('ad270000-0000-4000-8000-000000000010',true)$$,'draft owner enables randomized delivery');
select lives_ok($$select public.set_exam_student_assignments('ad270000-0000-4000-8000-000000000010',array['ad270000-0000-4000-8000-000000000001']::uuid[])$$,'teacher A assigns own exam');
select set_config('request.jwt.claim.sub','ad270000-0000-4000-8000-000000000002',true);
select is((select count(*)::integer from public.exams where id='ad270000-0000-4000-8000-000000000010'),0,'shared student gives no teacher exam access');
select lives_ok($$select public.set_exam_student_assignments('ad270000-0000-4000-8000-000000000011',array['ad270000-0000-4000-8000-000000000001']::uuid[])$$,'teacher B assigns own exam');
select lives_ok($$select public.publish_exam('ad270000-0000-4000-8000-000000000011',gen_random_uuid())$$,'teacher B publishes assigned exam');
select lives_ok($$select public.publish_exam('ad270000-0000-4000-8000-000000000012',gen_random_uuid())$$,'teacher B publishes unassigned exam');
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.publish_exam('ad270000-0000-4000-8000-000000000010',gen_random_uuid())$$,'teacher A publishes randomized exam');
select set_config('request.jwt.claim.sub','ad270000-0000-4000-8000-000000000001',true);
select is((select count(*)::integer from public.my_assigned_teachers()),2,'student profile lists both teachers');
select is((select count(*)::integer from public.exams where id in('ad270000-0000-4000-8000-000000000010','ad270000-0000-4000-8000-000000000011','ad270000-0000-4000-8000-000000000012')),2,'student sees only explicitly assigned exams across teachers');
select throws_ok($$select public.start_exam('ad270000-0000-4000-8000-000000000012')$$,'P0001','Student is not assigned to this exam','unassigned exam cannot start');
select lives_ok($$select public.start_exam('ad270000-0000-4000-8000-000000000010')$$,'randomized exam starts');
select is((select cardinality(question_sequence) from public.exam_attempts where exam_id='ad270000-0000-4000-8000-000000000010'),2,'attempt snapshots a complete permutation');
select set_config('test.original_order',(select question_sequence::text from public.exam_attempts where exam_id='ad270000-0000-4000-8000-000000000010'),true);
select is((public.start_exam('ad270000-0000-4000-8000-000000000010')).question_sequence::text,current_setting('test.original_order'),'resume returns stable order');
select is((select count(*)::integer from public.question_keys where question_id in('ad270000-0000-4000-8000-000000000030','ad270000-0000-4000-8000-000000000031')),0,'delivery never reveals keys');
select lives_ok($$select public.start_section((select id from public.exam_attempts where exam_id='ad270000-0000-4000-8000-000000000010'),'ad270000-0000-4000-8000-000000000020')$$,'randomized section starts');
select lives_ok($$select public.save_answer((select id from public.section_attempts where section_id='ad270000-0000-4000-8000-000000000020'),'ad270000-0000-4000-8000-000000000030','B',false,1)$$,'answer saves by question identity');
select lives_ok($$select public.submit_section((select id from public.section_attempts where section_id='ad270000-0000-4000-8000-000000000020'))$$,'submission persists');
select is((select raw_score from public.my_exam_history() where title='Expansion A'),null::integer,'profile hides unreleased mark');
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.update_exam_feature_settings('ad270000-0000-4000-8000-000000000010',true)$$,'teacher releases marks');
select throws_ok($$select public.set_exam_randomization('ad270000-0000-4000-8000-000000000010',false)$$,'P0001','Question delivery is locked','cannot change published delivery');
select set_config('request.jwt.claim.sub','ad270000-0000-4000-8000-000000000001',true);
select is((select raw_score from public.my_exam_history() where title='Expansion A'),1,'released grade is correct by question identity');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is((select count(*)::integer from public.my_exam_history() where title='Expansion A'),0,'other student cannot read grade');
select set_config('request.jwt.claim.sub','90000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.change_student_teacher_links(array['ad270000-0000-4000-8000-000000000001']::uuid[],'ad270000-0000-4000-8000-000000000002',true)$$,'admin removes only one teacher link');
select set_config('request.jwt.claim.sub','ad270000-0000-4000-8000-000000000001',true);
select is((select count(*)::integer from public.my_assigned_teachers()),1,'other teacher link survives removal');
select is((select count(*)::integer from public.exams where id='ad270000-0000-4000-8000-000000000011'),0,'removing teacher revokes unstarted exam access');
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.create_exam_draft('ad270000-0000-4000-8000-000000000050','Atomic draft',null,null,now(),now()+interval '1 hour','SAFE',false)$$,'draft and access code save together');
select lives_ok($$select public.create_exam_draft('ad270000-0000-4000-8000-000000000050','Atomic draft',null,null,now(),now()+interval '1 hour','SAFE',false)$$,'duplicate draft request reuses the same ID');
select is((select count(*)::integer from public.exams where id='ad270000-0000-4000-8000-000000000050'),1,'duplicate request creates exactly one draft');
select is((select access_code from public.exam_access_codes where exam_id='ad270000-0000-4000-8000-000000000050'),'SAFE','draft contains its access code');
select throws_ok($$select public.create_exam_draft('ad270000-0000-4000-8000-000000000051','Invalid draft',null,null,now(),now()+interval '1 hour',repeat('X',25),false)$$,'23514',null,'invalid code rolls back the draft');
select is((select count(*)::integer from public.exams where id='ad270000-0000-4000-8000-000000000051'),0,'failed draft has no partial row');
select * from finish();
rollback;
