begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(22);

select has_column('public','profiles','teacher_id','students can have a teacher owner');
select has_table('public','exam_student_assignments','exam assignments use a join table');
select col_is_pk('public','exam_student_assignments',array['exam_id','student_id'],'duplicate assignments are prevented');
select has_column('public','exam_sections','allow_calculator','calculator permission is per module');
select has_column('public','exams','show_results_to_students','result visibility is per exam');
select has_function('public','set_exam_student_assignments',array['uuid','uuid[]']);
select has_function('public','admin_factory_cleanup',array['text','text','uuid']);

update public.profiles set teacher_id='10000000-0000-0000-0000-000000000001'
where id in('20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002');
insert into public.exam_student_assignments(exam_id,student_id,assigned_by)
values('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001')
on conflict do nothing;

set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is((select count(*)::integer from public.exams where id='30000000-0000-0000-0000-000000000001'),1,'assigned student sees the exam');
select is((select count(*)::integer from public.exam_sections where exam_id='30000000-0000-0000-0000-000000000001'),3,'assigned student sees sections');

reset role;
delete from public.exam_student_assignments where exam_id='30000000-0000-0000-0000-000000000001' and student_id='20000000-0000-0000-0000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is((select count(*)::integer from public.exams where id='30000000-0000-0000-0000-000000000001'),0,'unassigned student cannot see the exam');
select throws_ok($$select public.start_exam('30000000-0000-0000-0000-000000000001',null)$$,'P0001','Student is not assigned to this exam','unassigned student cannot start by direct RPC');

select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select is((select count(*)::integer from public.profiles where role='student'),5,'teacher sees only owned students');
select is((select count(*)::integer from public.exam_access_codes where exam_id='30000000-0000-0000-0000-000000000001'),0,'teacher can query their exam code record');
select lives_ok($$select public.update_section_settings('40000000-0000-0000-0000-000000000002',180,false)$$,'teacher can edit break duration before attempts');
select is((select duration_seconds from public.exam_sections where id='40000000-0000-0000-0000-000000000002'),180,'break duration persists');
select throws_ok($$select public.update_section_settings('40000000-0000-0000-0000-000000000002',30,false)$$,'P0001','Duration must be between 1 and 240 minutes','invalid break duration is rejected');
select lives_ok($$select public.update_exam_feature_settings('30000000-0000-0000-0000-000000000001',false)$$,'teacher can hide student results');
select is((select show_results_to_students from public.exams where id='30000000-0000-0000-0000-000000000001'),false,'hidden-result setting persists');

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is((select raw_score from public.student_exam_attempt_summary('30000000-0000-0000-0000-000000000001')),null::integer,'hidden score RPC does not reveal marks');

select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select throws_ok($$select public.admin_factory_cleanup('exams','DELETE ALL EXAMS',gen_random_uuid())$$,'P0001','Super Admin access required','teacher cannot call factory cleanup');

select set_config('request.jwt.claim.sub','90000000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claims',jsonb_build_object('sub','90000000-0000-0000-0000-000000000001','iat',extract(epoch from now())::bigint)::text,true);
select lives_ok($$select public.admin_factory_cleanup('students','DELETE ALL STUDENTS','f9000000-0000-4000-8000-000000000001')$$,'recently authenticated Super Admin can run transactional student cleanup');
select results_eq($$select count(*)::integer from public.profiles group by role order by role::text$$,$$values (1),(1)$$,'factory cleanup preserves teacher and administrator accounts');

select * from finish();
rollback;
