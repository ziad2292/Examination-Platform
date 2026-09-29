begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

insert into public.user_import_batches(id,created_by,operation_key,filename,file_sha256,status,row_count,created_count,completed_at) values
  ('f0000000-0000-4000-8000-000000000001','90000000-0000-0000-0000-000000000001','f9000000-0000-4000-8000-000000000001','users.csv',repeat('a',64),'completed',1,1,now());
insert into public.user_import_items(batch_id,row_number,full_name,email,role,status,user_id) values
  ('f0000000-0000-4000-8000-000000000001',2,'Imported Student','imported@example.com','student','created','f1000000-0000-4000-8000-000000000001');

select hasnt_column('public','user_import_items','password','import journals never have a password column');
select ok((select created_at is not null from public.user_import_batches where id='f0000000-0000-4000-8000-000000000001'),'import batch records when it was performed');

set local role authenticated;
select set_config('request.jwt.claim.sub','90000000-0000-0000-0000-000000000001',true);
select is((select count(*)::integer from public.user_import_batches where id='f0000000-0000-4000-8000-000000000001'),1,'Super Admin can read import audit batches');
select is((select count(*)::integer from public.user_import_items where batch_id='f0000000-0000-4000-8000-000000000001'),1,'Super Admin can read per-row outcomes');

select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select is((select count(*)::integer from public.user_import_batches where id='f0000000-0000-4000-8000-000000000001'),0,'teacher cannot read Super Admin import audit batches');
select is((select count(*)::integer from public.user_import_items where batch_id='f0000000-0000-4000-8000-000000000001'),0,'teacher cannot read import row outcomes');

select * from finish();
rollback;
