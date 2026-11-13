-- Read-only local catalog and representative query-plan inspection.
select version();
select relname,relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind='r' order by relname;
select p.proname,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.prosecdef and not coalesce(array_to_string(p.proconfig,','),'') like '%search_path%';
select count(*) as connections from pg_stat_activity;
show max_connections;
select schemaname,relname,n_live_tup,seq_scan,idx_scan from pg_stat_user_tables where schemaname='public' order by relname;
select tablename,indexname,indexdef from pg_indexes where schemaname='public' order by tablename,indexname;
select jobname,schedule,active from cron.job;
select tablename from pg_publication_tables where pubname='supabase_realtime';
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
explain (analyze,buffers) select id,title,status,scheduled_start_at from public.exams
where status in ('published','closed') order by scheduled_start_at desc;
explain (analyze,buffers) select * from public.student_exam_attempt_summary('30000000-0000-0000-0000-000000000001');
rollback;
