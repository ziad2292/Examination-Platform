-- LOCAL DISPOSABLE SUPABASE ONLY. Dedicated ac11/ac12 namespaces.
begin;
insert into auth.users(instance_id,id,aud,role,email,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
select '00000000-0000-0000-0000-000000000000',('ac110001-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'authenticated','authenticated','integrity-load-'||i||'@example.invalid',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}' from generate_series(1,500) i;
insert into public.profiles(id,full_name,email,role,teacher_id)
select ('ac110001-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'Integrity load student '||i,'integrity-load-'||i||'@example.invalid','student','10000000-0000-0000-0000-000000000001' from generate_series(1,500) i;
insert into public.exams(id,title,status,scheduled_start_at,scheduled_end_at,created_by) values('ac110000-0000-4000-8000-000000000001','Disposable integrity load fixture','published',now()-interval '1 hour',now()+interval '1 hour','10000000-0000-0000-0000-000000000001');
insert into public.exam_integrity_settings(exam_id,enabled,enforcement) values('ac110000-0000-4000-8000-000000000001',true,true);
insert into public.exam_attempts(id,exam_id,student_id) select ('ac110002-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'ac110000-0000-4000-8000-000000000001',('ac110001-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid from generate_series(1,500) i;
commit;
