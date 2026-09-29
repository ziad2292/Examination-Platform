begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select plan(24);

select has_table('public','question_import_batches','import batches are persisted');
select has_table('public','question_import_items','import items are auditable');
select has_function('public','bulk_create_questions',array['uuid','uuid','uuid','jsonb'],'atomic bulk RPC exists');

insert into public.exams(id,title,status,scheduled_start_at,scheduled_end_at,created_by)
values('91000000-0000-4000-8000-000000000001','Bulk import fixture','draft',now()-interval '1 hour',now()+interval '1 day','10000000-0000-0000-0000-000000000001');
insert into public.exam_sections(id,exam_id,title,section_type,section_order,duration_seconds)
values
('92000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001','Module','module',1,600),
('92000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000001','Break','break',2,60);
insert into public.questions(id,section_id,question_order,optional_text,option_a,option_b,option_c,option_d)
values('93000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001',1,'Existing','A','B','C','D');
insert into public.question_keys(question_id,correct_option)
values('93000000-0000-4000-8000-000000000001','A');

insert into storage.objects(bucket_id,name,owner,owner_id,metadata)
select 'question-images',
  'question-import-staging/10000000-0000-0000-0000-000000000001/94000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-'||lpad(i::text,12,'0')||'.png',
  '10000000-0000-0000-0000-000000000001'::uuid,
  '10000000-0000-0000-0000-000000000001',
  jsonb_build_object('size',1024,'mimetype','image/png')
from generate_series(1,30) i;

set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);

select lives_ok($$
  select * from public.bulk_create_questions(
    '91000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000001',
    '94000000-0000-4000-8000-000000000001',
    (select jsonb_agg(jsonb_build_object(
      'position',i,
      'imagePath','question-import-staging/10000000-0000-0000-0000-000000000001/94000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-'||lpad(i::text,12,'0')||'.png',
      'correctOption',(array['A','B','C','D'])[1+((i-1)%4)],
      'originalFilename','سؤال-'||i||'.png',
      'sha256',lpad(to_hex(i),64,'0')
    ) order by i) from generate_series(1,30) i)
  )
$$,'30-image import succeeds');

select is((select count(*)::integer from public.question_import_items where batch_id='94000000-0000-4000-8000-000000000001'),30,'exactly 30 batch items exist');
select is((select count(*)::integer from public.question_keys k join public.question_import_items i on i.question_id=k.question_id where i.batch_id='94000000-0000-4000-8000-000000000001'),30,'exactly 30 protected keys exist');
select is((select row(min(q.question_order),max(q.question_order),count(distinct q.question_order)::integer)::text from public.questions q join public.question_import_items i on i.question_id=q.id where i.batch_id='94000000-0000-4000-8000-000000000001'),'(2,31,30)','orders append contiguously after existing questions');
select is((select status::text from public.question_import_batches where id='94000000-0000-4000-8000-000000000001'),'completed','batch audit record is completed');

select lives_ok($$
  select * from public.bulk_create_questions(
    '91000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001',
    (select jsonb_agg(jsonb_build_object('position',i,'imagePath','question-import-staging/10000000-0000-0000-0000-000000000001/94000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-'||lpad(i::text,12,'0')||'.png','correctOption',(array['A','B','C','D'])[1+((i-1)%4)],'originalFilename','سؤال-'||i||'.png','sha256',lpad(to_hex(i),64,'0')) order by i) from generate_series(1,30)i)
  )
$$,'completed batch retry succeeds idempotently');
select is((select count(*)::integer from public.question_import_items where batch_id='94000000-0000-4000-8000-000000000001'),30,'retry creates no duplicates');

reset role;
insert into storage.objects(bucket_id,name,owner,owner_id,metadata)
select 'question-images','question-import-staging/10000000-0000-0000-0000-000000000001/94000000-0000-4000-8000-000000000002/00000000-0000-4000-8000-'||lpad(i::text,12,'0')||'.jpg','10000000-0000-0000-0000-000000000001'::uuid,'10000000-0000-0000-0000-000000000001',jsonb_build_object('size',2048,'mimetype','image/jpeg') from generate_series(31,32)i;
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select lives_ok($$
  select * from public.bulk_create_questions('91000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000002',
    (select jsonb_agg(jsonb_build_object('position',i-30,'imagePath','question-import-staging/10000000-0000-0000-0000-000000000001/94000000-0000-4000-8000-000000000002/00000000-0000-4000-8000-'||lpad(i::text,12,'0')||'.jpg','correctOption','A','originalFilename','q'||i||'.jpg','sha256',lpad(to_hex(i),64,'0')) order by i) from generate_series(31,32)i))
$$,'a separate batch appends safely');
select is((select row(min(q.question_order),max(q.question_order))::text from public.questions q join public.question_import_items i on i.question_id=q.id where i.batch_id='94000000-0000-4000-8000-000000000002'),'(32,33)','separate batch receives deterministic unique order');

select throws_ok($$
  select * from public.bulk_create_questions('91000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000003','[{"position":1,"imagePath":"missing","correctOption":null,"originalFilename":"x.png","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]'::jsonb)
$$,'P0001','Invalid import item','missing correct answer rejects the entire batch');
select is((select count(*)::integer from public.question_import_items where batch_id='94000000-0000-4000-8000-000000000003'),0,'missing-answer batch commits zero questions');

select throws_ok($$
  select * from public.bulk_create_questions('91000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000004','[{"position":1,"imagePath":"question-import-staging/10000000-0000-0000-0000-000000000001/94000000-0000-4000-8000-000000000004/00000000-0000-4000-8000-000000000004.png","correctOption":"A","originalFilename":"bad.png","sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}]'::jsonb)
$$,'P0001','One or more staged images are missing or invalid','missing/invalid Storage object rejects the batch');

select throws_ok($$
  select * from public.bulk_create_questions('91000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000005','[]'::jsonb)
$$,'P0001','Import must contain between 1 and 50 questions','empty batch is rejected');

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select throws_ok($$
  select * from public.bulk_create_questions('91000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000006','[]'::jsonb)
$$,'P0001','Teacher account required','student cannot execute a bulk import');
select is((select count(*)::integer from public.question_import_batches),0,'student cannot inspect teacher import batches through RLS');

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
reset role;
update public.profiles set role='teacher' where id='20000000-0000-0000-0000-000000000005';
set local role authenticated;
select throws_ok($$
  select * from public.bulk_create_questions('91000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000007','[{"position":1,"imagePath":"x","correctOption":"A","originalFilename":"x.png","sha256":"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"}]'::jsonb)
$$,'P0001','Section not found','another teacher cannot import into this module');

reset role;
update public.profiles set role='student' where id='20000000-0000-0000-0000-000000000005';
insert into storage.objects(bucket_id,name,owner,owner_id,metadata) values
('question-images','question-import-staging/10000000-0000-0000-0000-000000000001/94000000-0000-4000-8000-000000000010/00000000-0000-4000-8000-000000000010.png','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','{"size":1024,"mimetype":"image/png"}'),
('question-images','question-import-staging/10000000-0000-0000-0000-000000000001/94000000-0000-4000-8000-000000000010/00000000-0000-4000-8000-000000000011.png','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','{"size":1024,"mimetype":"image/png"}');
insert into public.questions(id,section_id,question_order,image_path,option_a,option_b,option_c,option_d)
values('93000000-0000-4000-8000-000000000010','92000000-0000-4000-8000-000000000001',34,'question-import-staging/10000000-0000-0000-0000-000000000001/94000000-0000-4000-8000-000000000010/00000000-0000-4000-8000-000000000010.png','A','B','C','D');
insert into public.question_keys(question_id,correct_option) values('93000000-0000-4000-8000-000000000010','A');
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select throws_ok($$
  select * from public.bulk_create_questions('91000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000010','[{"position":1,"imagePath":"question-import-staging/10000000-0000-0000-0000-000000000001/94000000-0000-4000-8000-000000000010/00000000-0000-4000-8000-000000000010.png","correctOption":"A","originalFilename":"one.png","sha256":"1111111111111111111111111111111111111111111111111111111111111111"},{"position":2,"imagePath":"question-import-staging/10000000-0000-0000-0000-000000000001/94000000-0000-4000-8000-000000000010/00000000-0000-4000-8000-000000000011.png","correctOption":"B","originalFilename":"two.png","sha256":"2222222222222222222222222222222222222222222222222222222222222222"}]'::jsonb)
$$,'23505','duplicate key value violates unique constraint "questions_image_path_unique"','mid-transaction insert failure is surfaced');
select is((select count(*)::integer from public.question_import_items where batch_id='94000000-0000-4000-8000-000000000010'),0,'failed transaction leaves zero batch items');

reset role;
insert into public.exam_attempts(id,exam_id,student_id) values('95000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001','20000000-0000-0000-0000-000000000001');
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select throws_ok($$
  select * from public.bulk_create_questions('91000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000008','[{"position":1,"imagePath":"x","correctOption":"A","originalFilename":"x.png","sha256":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}]'::jsonb)
$$,'P0001','Exam is locked','attempt makes exam immutable');
select is((select count(*)::integer from public.questions where section_id='92000000-0000-4000-8000-000000000001'),34,'immutable rejection leaves questions unchanged');

reset role;
delete from public.exam_attempts where id='95000000-0000-4000-8000-000000000001';
update public.exams set status='archived' where id='91000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select throws_ok($$
  select * from public.bulk_create_questions('91000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000009','[{"position":1,"imagePath":"x","correctOption":"A","originalFilename":"x.png","sha256":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"}]'::jsonb)
$$,'P0001','Exam is not editable','archived exam rejects imports');

select * from finish();
rollback;
