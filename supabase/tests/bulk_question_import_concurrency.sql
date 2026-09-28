create extension if not exists pgtap with schema extensions;
create extension if not exists dblink;
set search_path=public,extensions;

set session_replication_role=replica;
delete from storage.objects where name like 'question-import-staging/10000000-0000-0000-0000-000000000001/96000000-0000-4000-8000-%';
set session_replication_role=origin;
delete from public.exams where id='96000000-0000-4000-8000-000000000001';
insert into public.exams(id,title,status,scheduled_start_at,scheduled_end_at,created_by)
values('96000000-0000-4000-8000-000000000001','Concurrent import fixture','draft',now()-interval '1 hour',now()+interval '1 day','10000000-0000-0000-0000-000000000001');
insert into public.exam_sections(id,exam_id,title,section_type,section_order,duration_seconds)
values('96000000-0000-4000-8000-000000000002','96000000-0000-4000-8000-000000000001','Module','module',1,600);
insert into storage.objects(bucket_id,name,owner,owner_id,metadata) values
('question-images','question-import-staging/10000000-0000-0000-0000-000000000001/96000000-0000-4000-8000-000000000010/96000000-0000-4000-8000-000000000010.png','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','{"size":100,"mimetype":"image/png"}'),
('question-images','question-import-staging/10000000-0000-0000-0000-000000000001/96000000-0000-4000-8000-000000000020/96000000-0000-4000-8000-000000000020.png','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','{"size":100,"mimetype":"image/png"}'),
('question-images','question-import-staging/10000000-0000-0000-0000-000000000001/96000000-0000-4000-8000-000000000030/96000000-0000-4000-8000-000000000030.png','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','{"size":100,"mimetype":"image/png"}');

select plan(6);
select dblink_connect('same_a',format('dbname=%I user=postgres password=postgres host=host.docker.internal port=54322',current_database()));
select dblink_connect('same_b',format('dbname=%I user=postgres password=postgres host=host.docker.internal port=54322',current_database()));
select dblink_exec('same_a','set role authenticated');
select dblink_exec('same_b','set role authenticated');
select * from dblink('same_a',$$select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false)$$) as t(value text);
select * from dblink('same_b',$$select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false)$$) as t(value text);

select dblink_send_query('same_a',$$select question_count from public.bulk_create_questions('96000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000002','96000000-0000-4000-8000-000000000010','[{"position":1,"imagePath":"question-import-staging/10000000-0000-0000-0000-000000000001/96000000-0000-4000-8000-000000000010/96000000-0000-4000-8000-000000000010.png","correctOption":"A","originalFilename":"same.png","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]'::jsonb)$$);
select dblink_send_query('same_b',$$select question_count from public.bulk_create_questions('96000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000002','96000000-0000-4000-8000-000000000010','[{"position":1,"imagePath":"question-import-staging/10000000-0000-0000-0000-000000000001/96000000-0000-4000-8000-000000000010/96000000-0000-4000-8000-000000000010.png","correctOption":"A","originalFilename":"same.png","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]'::jsonb)$$);
select is((select question_count from dblink_get_result('same_a') as t(question_count integer)),1,'first identical concurrent request succeeds');
select is((select question_count from dblink_get_result('same_b') as t(question_count integer)),1,'second identical concurrent request returns the same result');
select is((select count(*)::integer from public.questions where section_id='96000000-0000-4000-8000-000000000002'),1,'identical concurrent requests create one logical question');
select dblink_disconnect('same_a');
select dblink_disconnect('same_b');

select dblink_connect('different_a',format('dbname=%I user=postgres password=postgres host=host.docker.internal port=54322',current_database()));
select dblink_connect('different_b',format('dbname=%I user=postgres password=postgres host=host.docker.internal port=54322',current_database()));
select dblink_exec('different_a','set role authenticated');
select dblink_exec('different_b','set role authenticated');
select * from dblink('different_a',$$select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false)$$) as t(value text);
select * from dblink('different_b',$$select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false)$$) as t(value text);
select dblink_send_query('different_a',$$select question_count from public.bulk_create_questions('96000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000002','96000000-0000-4000-8000-000000000020','[{"position":1,"imagePath":"question-import-staging/10000000-0000-0000-0000-000000000001/96000000-0000-4000-8000-000000000020/96000000-0000-4000-8000-000000000020.png","correctOption":"B","originalFilename":"a.png","sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}]'::jsonb)$$);
select dblink_send_query('different_b',$$select question_count from public.bulk_create_questions('96000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000002','96000000-0000-4000-8000-000000000030','[{"position":1,"imagePath":"question-import-staging/10000000-0000-0000-0000-000000000001/96000000-0000-4000-8000-000000000030/96000000-0000-4000-8000-000000000030.png","correctOption":"C","originalFilename":"b.png","sha256":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}]'::jsonb)$$);
select is((select question_count from dblink_get_result('different_a') as t(question_count integer)),1,'first independent concurrent batch succeeds');
select is((select question_count from dblink_get_result('different_b') as t(question_count integer)),1,'second independent concurrent batch succeeds');
select is((select row(count(*),count(distinct question_order),min(question_order),max(question_order))::text from public.questions where section_id='96000000-0000-4000-8000-000000000002'),'(3,3,1,3)','independent concurrent batches have unique contiguous order');
select dblink_disconnect('different_a');
select dblink_disconnect('different_b');

select * from finish();
delete from public.exams where id='96000000-0000-4000-8000-000000000001';
set session_replication_role=replica;
delete from storage.objects where name like 'question-import-staging/10000000-0000-0000-0000-000000000001/96000000-0000-4000-8000-%';
set session_replication_role=origin;
