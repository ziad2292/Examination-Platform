begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(22);

insert into public.exams(id,title,status,scheduled_start_at,scheduled_end_at,created_by)
values('a0000000-0000-0000-0000-000000000001','State fixture','draft',now()-interval '1 hour',now()+interval '1 hour','10000000-0000-0000-0000-000000000001');

select throws_ok($$update public.exams set status='published' where id='a0000000-0000-0000-0000-000000000001'$$,'P0001','An exam needs at least one section before publishing','empty exam cannot publish');
insert into public.exam_sections(id,exam_id,title,section_type,section_order,duration_seconds)
values
  ('a1000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','Module 1','module',1,600),
  ('a1000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000001','Module 2','module',2,600);
select throws_ok($$update public.exams set status='published' where id='a0000000-0000-0000-0000-000000000001'$$,'P0001','Every module needs at least one question','empty module cannot publish');

insert into public.questions(id,section_id,question_order,optional_text,option_a,option_b,option_c,option_d)
values
  ('a2000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001',1,'Q1','A','B','C','D'),
  ('a2000000-0000-0000-0000-000000000002','a1000000-0000-0000-0000-000000000001',2,'Q2','A','B','C','D'),
  ('a2000000-0000-0000-0000-000000000003','a1000000-0000-0000-0000-000000000002',1,'Q3','A','B','C','D');
select throws_ok($$update public.exams set status='published' where id='a0000000-0000-0000-0000-000000000001'$$,'P0001','Every question needs an answer key','question without key cannot publish');
insert into public.question_keys(question_id,correct_option) values
  ('a2000000-0000-0000-0000-000000000001','B'),
  ('a2000000-0000-0000-0000-000000000002','A'),
  ('a2000000-0000-0000-0000-000000000003','C');
select lives_ok($$update public.exams set status='published',published_at=now() where id='a0000000-0000-0000-0000-000000000001'$$,'valid exam publishes');

set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select lives_ok($$select public.start_exam('a0000000-0000-0000-0000-000000000001',null)$$,'student starts exam');
select is((select count(*)::integer from public.exam_attempts where exam_id='a0000000-0000-0000-0000-000000000001'),1,'duplicate start creates one attempt');
select lives_ok($$select public.start_exam('a0000000-0000-0000-0000-000000000001',null)$$,'duplicate start is idempotent');
select throws_ok($$select public.start_section((select id from public.exam_attempts where exam_id='a0000000-0000-0000-0000-000000000001'),'a1000000-0000-0000-0000-000000000002')$$,'P0001','Section is not next','student cannot skip a section');
select lives_ok($$select public.start_section((select id from public.exam_attempts where exam_id='a0000000-0000-0000-0000-000000000001'),'a1000000-0000-0000-0000-000000000001')$$,'first section starts');
select is((select count(*)::integer from public.section_attempts where section_id='a1000000-0000-0000-0000-000000000001'),1,'duplicate section start creates one row');
select lives_ok($$select public.start_section((select id from public.exam_attempts where exam_id='a0000000-0000-0000-0000-000000000001'),'a1000000-0000-0000-0000-000000000001')$$,'duplicate section start is idempotent');
select throws_ok($$select public.save_answer((select id from public.section_attempts where section_id='a1000000-0000-0000-0000-000000000001'),'a2000000-0000-0000-0000-000000000003','A',false,1)$$,'P0001','Question is outside this section','cross-section answer is rejected');
select throws_ok($$select public.save_answer((select id from public.section_attempts where section_id='a1000000-0000-0000-0000-000000000001'),'a2000000-0000-0000-0000-000000000001','B',false,-1)$$,'23514',null,'negative revisions are rejected');
select lives_ok($$select public.save_answer((select id from public.section_attempts where section_id='a1000000-0000-0000-0000-000000000001'),'a2000000-0000-0000-0000-000000000001','B',false,2)$$,'valid answer saves');
select lives_ok($$select public.save_answer((select id from public.section_attempts where section_id='a1000000-0000-0000-0000-000000000001'),'a2000000-0000-0000-0000-000000000001','A',false,1)$$,'stale answer is safely ignored');
select is((select selected_option::text from public.answers where question_id='a2000000-0000-0000-0000-000000000001'),'B','newest revision wins');
select lives_ok($$select public.submit_section((select id from public.section_attempts where section_id='a1000000-0000-0000-0000-000000000001'))$$,'first section submits');
select throws_ok($$select public.save_answer((select id from public.section_attempts where section_id='a1000000-0000-0000-0000-000000000001'),'a2000000-0000-0000-0000-000000000001','A',false,3)$$,'P0001','Section is closed','submitted answers are immutable');

reset role;
select throws_ok($$update public.exams set status='archived' where id='a0000000-0000-0000-0000-000000000001'$$,'P0001','Cannot archive an exam with active attempts','active exam cannot be archived');

set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select lives_ok($$select public.start_section((select id from public.exam_attempts where exam_id='a0000000-0000-0000-0000-000000000001'),'a1000000-0000-0000-0000-000000000002')$$,'next section starts after submission');
select lives_ok($$select public.submit_section((select id from public.section_attempts where section_id='a1000000-0000-0000-0000-000000000002'))$$,'final section completes exam');
select results_eq($$select status::text,raw_score,total_questions from public.exam_attempts where exam_id='a0000000-0000-0000-0000-000000000001'$$,$$select 'completed'::text,1::integer,3::integer$$,'grading is deterministic and counts unanswered questions');

select * from finish();
rollback;
