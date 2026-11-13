-- Remove only the exact disposable load fixture, preserving all other data.
begin;
delete from public.exam_attempts where exam_id='ac110000-0000-4000-8000-000000000001';
delete from public.exams where id='ac110000-0000-4000-8000-000000000001' and title='Disposable integrity load fixture';
delete from auth.users where id in(select ('ac110001-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid from generate_series(1,500) i) and email like 'integrity-load-%@example.invalid';
commit;
