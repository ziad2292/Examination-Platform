-- Optional integrity monitoring. No grading or exam-clock changes.
create table public.exam_integrity_settings (
 exam_id uuid primary key references public.exams(id) on delete cascade,
 enabled boolean not null default false, require_fullscreen boolean not null default true,
 restrict_clipboard boolean not null default true, threshold integer not null default 3 check(threshold between 1 and 100),
 cooldown_seconds integer not null default 10 check(cooldown_seconds between 1 and 300),
 enforcement boolean not null default false, version integer not null default 1, updated_at timestamptz not null default now()
);
create table public.integrity_review_actions (
 id uuid primary key default gen_random_uuid(), exam_id uuid not null references public.exams(id) on delete cascade,
 attempt_id uuid references public.exam_attempts(id) on delete cascade, student_id uuid references public.profiles(id) on delete cascade,
 event_id uuid, action text not null check(action in('dismiss','reinstate','note','exception','revoke_exception','settings')),
 reason text not null check(length(trim(reason)) between 3 and 1000), actor_id uuid not null references public.profiles(id), created_at timestamptz not null default now()
);
create table public.attempt_integrity_state (
 attempt_id uuid primary key references public.exam_attempts(id) on delete cascade,
 exam_id uuid not null references public.exams(id) on delete cascade,
 policy jsonb not null, fullscreen_exception boolean not null default false,
 counted_incidents integer not null default 0, review_required boolean not null default false,
 flagged_at timestamptz, review_cycle integer not null default 0, revision bigint not null default 0,
 last_contact_at timestamptz, overlap_active boolean not null default false,
 created_at timestamptz not null default now()
);
create table public.attempt_browser_sessions (
 attempt_id uuid not null references public.exam_attempts(id) on delete cascade,
 browser_instance_id uuid not null, document_id uuid not null,
 first_contact_at timestamptz not null default now(), last_contact_at timestamptz not null default now(),
 lifecycle text not null default 'active' check(lifecycle in('active','exited')),
 attention_open boolean not null default false,
 primary key(attempt_id,browser_instance_id,document_id)
);
create table public.attempt_integrity_events (
 attempt_id uuid not null references public.exam_attempts(id) on delete cascade,
 event_id uuid not null, browser_instance_id uuid not null, document_id uuid not null, sequence bigint not null check(sequence>=0),
 section_attempt_id uuid references public.section_attempts(id) on delete cascade,
 type text not null check(type in('attention_lost','attention_returned','fullscreen_exit','clipboard','shortcut','offline','reconnect','reload','exit','overflow','overlap','fullscreen_exception','module_ready')),
 category text not null check(category in('attention','restriction','session','lifecycle')),
 observed_at timestamptz not null, received_at timestamptz not null default now(),
 severity text not null check(severity in('info','warning')), counted boolean not null default false,
 decision text not null, metadata jsonb not null default '{}',
 primary key(attempt_id,event_id), unique(attempt_id,browser_instance_id,document_id,sequence)
);
create index integrity_summary_exam_idx on public.attempt_integrity_state(exam_id,review_required);
create index integrity_events_timeline_idx on public.attempt_integrity_events(attempt_id,received_at desc);
create index integrity_sessions_contact_idx on public.attempt_browser_sessions(attempt_id,last_contact_at);
create index integrity_reviews_attempt_idx on public.integrity_review_actions(attempt_id,created_at);
create index integrity_exceptions_idx on public.integrity_review_actions(exam_id,student_id,created_at desc) where action in('exception','revoke_exception');

do $$ declare t text; begin
 foreach t in array array['exam_integrity_settings','attempt_integrity_state','attempt_browser_sessions','attempt_integrity_events','integrity_review_actions'] loop
 execute format('alter table public.%I enable row level security',t);
 end loop;
end $$;
create policy integrity_settings_read on public.exam_integrity_settings for select to authenticated using(public.is_active_user() and (public.owns_exam(exam_id) or public.is_superadmin()));
create policy integrity_summary_read on public.attempt_integrity_state for select to authenticated using(public.is_active_user() and (public.owns_exam(exam_id) or public.is_superadmin()));
create policy integrity_events_read on public.attempt_integrity_events for select to authenticated using(public.is_active_user() and exists(select 1 from public.attempt_integrity_state s where s.attempt_id=attempt_integrity_events.attempt_id and (public.owns_exam(s.exam_id) or public.is_superadmin())));
create policy integrity_sessions_read on public.attempt_browser_sessions for select to authenticated using(public.is_active_user() and exists(select 1 from public.attempt_integrity_state s where s.attempt_id=attempt_browser_sessions.attempt_id and (public.owns_exam(s.exam_id) or public.is_superadmin())));
create policy integrity_reviews_read on public.integrity_review_actions for select to authenticated using(public.is_active_user() and (public.owns_exam(exam_id) or public.is_superadmin()));
revoke all on public.exam_integrity_settings,public.attempt_integrity_state,public.attempt_browser_sessions,public.attempt_integrity_events,public.integrity_review_actions from anon,authenticated;
grant select on public.exam_integrity_settings,public.attempt_integrity_state,public.attempt_browser_sessions,public.attempt_integrity_events,public.integrity_review_actions to authenticated;

create function public.snapshot_attempt_integrity() returns trigger language plpgsql security definer set search_path='' as $$
declare settings public.exam_integrity_settings; exception_action text;
begin
 select * into settings from public.exam_integrity_settings where exam_id=new.exam_id;
 select action into exception_action from public.integrity_review_actions where exam_id=new.exam_id and student_id=new.student_id and action in('exception','revoke_exception') order by created_at desc,id desc limit 1;
 insert into public.attempt_integrity_state(attempt_id,exam_id,policy,fullscreen_exception)
 values(new.id,new.exam_id,coalesce(to_jsonb(settings),'{}')||jsonb_build_object('enabled',coalesce(settings.enabled,false)),coalesce(exception_action='exception',false));
 return new;
end $$;
create trigger snapshot_attempt_integrity after insert on public.exam_attempts for each row execute function public.snapshot_attempt_integrity();
insert into public.attempt_integrity_state(attempt_id,exam_id,policy) select id,exam_id,'{"enabled":false}' from public.exam_attempts;

create function public.configure_exam_integrity(target_exam uuid,settings jsonb,change_reason text) returns void language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.exams where id=target_exam for update;
 if not public.is_active_user() or not(public.owns_exam(target_exam) or public.is_superadmin()) then raise exception 'Exam not found' using errcode='42501'; end if;
 if length(trim(coalesce(change_reason,''))) not between 3 and 1000 then raise exception 'Reason required'; end if;
 if jsonb_typeof(settings)<>'object' or settings - array['enabled','require_fullscreen','restrict_clipboard','threshold','cooldown_seconds','enforcement'] <> '{}' then raise exception 'Invalid settings'; end if;
 insert into public.exam_integrity_settings(exam_id,enabled,require_fullscreen,restrict_clipboard,threshold,cooldown_seconds,enforcement)
 values(target_exam,(settings->>'enabled')::boolean,(settings->>'require_fullscreen')::boolean,(settings->>'restrict_clipboard')::boolean,(settings->>'threshold')::integer,(settings->>'cooldown_seconds')::integer,(settings->>'enforcement')::boolean)
 on conflict(exam_id) do update set enabled=excluded.enabled,require_fullscreen=excluded.require_fullscreen,restrict_clipboard=excluded.restrict_clipboard,threshold=excluded.threshold,cooldown_seconds=excluded.cooldown_seconds,enforcement=excluded.enforcement,version=public.exam_integrity_settings.version+1,updated_at=now();
 insert into public.integrity_review_actions(exam_id,action,reason,actor_id) values(target_exam,'settings',change_reason,auth.uid());
end $$;

create function public.recompute_integrity_summary(target_attempt uuid) returns void language plpgsql security definer set search_path='' as $$
declare total integer; s public.attempt_integrity_state; flagged boolean;
begin
 select * into s from public.attempt_integrity_state where attempt_id=target_attempt for update;
 select count(*) into total from public.attempt_integrity_events e where e.attempt_id=target_attempt and e.counted and coalesce((select r.action from public.integrity_review_actions r where r.attempt_id=target_attempt and r.event_id=e.event_id and r.action in('dismiss','reinstate') order by r.created_at desc,r.id desc limit 1),'reinstate')<>'dismiss';
 flagged:=total>=coalesce((s.policy->>'threshold')::integer,3);
 update public.attempt_integrity_state set counted_incidents=total,review_required=flagged,
 flagged_at=case when flagged and not s.review_required then clock_timestamp() when flagged then s.flagged_at else null end,
 review_cycle=review_cycle+case when flagged and not s.review_required then 1 else 0 end,revision=revision+1 where attempt_id=target_attempt;
end $$;

create function public.review_exam_integrity(target_exam uuid,target_attempt uuid,target_student uuid,target_event uuid,review_action text,change_reason text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_active_user() or not(public.owns_exam(target_exam) or public.is_superadmin()) then raise exception 'Exam not found' using errcode='42501'; end if;
 if length(trim(coalesce(change_reason,''))) not between 3 and 1000 then raise exception 'Reason required'; end if;
 if review_action in('exception','revoke_exception') then
  if not exists(select 1 from public.exam_student_assignments where exam_id=target_exam and student_id=target_student) or exists(select 1 from public.exam_attempts where exam_id=target_exam and student_id=target_student) then raise exception 'Exception must be configured for an assigned student before starting'; end if;
 elsif review_action in('dismiss','reinstate','note') then
  perform 1 from public.attempt_integrity_state where attempt_id=target_attempt and exam_id=target_exam for update;
  if not found then raise exception 'Attempt not found'; end if;
  if review_action<>'note' and not exists(select 1 from public.attempt_integrity_events where attempt_id=target_attempt and event_id=target_event) then raise exception 'Event not found'; end if;
 else raise exception 'Invalid review action'; end if;
 insert into public.integrity_review_actions(exam_id,attempt_id,student_id,event_id,action,reason,actor_id)
 values(target_exam,case when review_action in('exception','revoke_exception') then null else target_attempt end,target_student,target_event,review_action,change_reason,auth.uid());
 if target_attempt is not null then perform public.recompute_integrity_summary(target_attempt); end if;
end $$;

create function public.integrity_sync(target_attempt uuid,browser_instance uuid,document_instance uuid,observations jsonb default '[]',registration boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.exam_attempts; s public.attempt_integrity_state; session_row public.attempt_browser_sessions; item jsonb; kind text; cat text; stamp timestamptz; section_id uuid; active_module boolean; counted boolean; decision text; event_uuid uuid; seq bigint; inserted integer; acknowledgements jsonb:='[]'; overlap boolean; had_overlap boolean; terminal boolean;
begin
 select * into a from public.exam_attempts where id=target_attempt for update;
 if not public.is_active_user() or a.student_id is distinct from auth.uid() or not exists(select 1 from public.profiles where id=auth.uid() and role='student') then raise exception 'Attempt not found' using errcode='42501'; end if;
 terminal:=a.status<>'in_progress';
 if terminal and coalesce(a.completed_at,a.started_at)<now()-interval '10 minutes' then raise exception 'Monitoring session closed' using errcode='42501'; end if;
 if browser_instance is null or document_instance is null or jsonb_typeof(observations)<>'array' or jsonb_array_length(observations)>50 or octet_length(observations::text)>32768 then raise exception 'Invalid observation batch'; end if;
 select * into s from public.attempt_integrity_state where attempt_id=target_attempt for update;
 if not coalesce((s.policy->>'enabled')::boolean,false) then return jsonb_build_object('enabled',false,'acknowledged','[]'::jsonb); end if;
 select * into session_row from public.attempt_browser_sessions where attempt_id=target_attempt and browser_instance_id=browser_instance and document_id=document_instance;
 if not registration and session_row.attempt_id is null then raise exception 'Register session first'; end if;
 -- Bound per-document ingestion independently of HTTP callers.
 if (select count(*) from public.attempt_integrity_events where attempt_id=target_attempt and received_at>now()-interval '1 minute')>300 then raise exception 'Observation rate exceeded' using errcode='54000'; end if;
 insert into public.attempt_browser_sessions(attempt_id,browser_instance_id,document_id) values(target_attempt,browser_instance,document_instance)
 on conflict(attempt_id,browser_instance_id,document_id) do update set last_contact_at=now(),lifecycle='active';
 for item in select value from jsonb_array_elements(observations) loop
  if jsonb_typeof(item)<>'object' or item-array['eventId','sequence','type','sectionAttemptId','observedAt','metadata']<>'{}' then raise exception 'Invalid event shape'; end if;
  kind:=item->>'type'; event_uuid:=(item->>'eventId')::uuid;seq:=(item->>'sequence')::bigint;stamp:=(item->>'observedAt')::timestamptz;section_id:=nullif(item->>'sectionAttemptId','')::uuid;
  if event_uuid is null or seq is null or seq<0 or stamp is null or kind is null or kind not in('attention_lost','attention_returned','fullscreen_exit','clipboard','shortcut','offline','reconnect','reload','exit','overflow','module_ready') or stamp>now()+interval '5 seconds' then raise exception 'Invalid observation'; end if;
  if coalesce(item->'metadata','{}')<>'{}' then raise exception 'Observation metadata must be empty'; end if;
  if exists(select 1 from public.attempt_integrity_events where attempt_id=target_attempt and (event_id=event_uuid or (browser_instance_id=browser_instance and document_id=document_instance and sequence=seq))) then acknowledgements:=acknowledgements||jsonb_build_array(event_uuid);continue;end if;
  active_module:=false;
  if section_id is not null then
   select sa.status='in_progress' and sa.expires_at>now() and es.section_type='module' into active_module from public.section_attempts sa join public.exam_sections es on es.id=sa.section_id where sa.id=section_id and sa.exam_attempt_id=target_attempt;
   if not found then raise exception 'Section does not belong to attempt' using errcode='42501';end if;
  end if;
  cat:=case when kind in('attention_lost','attention_returned','fullscreen_exit') then 'attention' when kind in('clipboard','shortcut') then 'restriction' else 'lifecycle' end;
  counted:=false;decision:='informational';
  if not terminal and coalesce(active_module,false) and cat in('attention','restriction') and kind<>'attention_returned' then
   decision:='counted';counted:=true;
   if stamp<now()-interval '30 seconds' then decision:='delayed';counted:=false;
   elsif not coalesce((s.policy->>'enforcement')::boolean,false) then decision:='logging_only';counted:=false;
   elsif cat='restriction' and not coalesce((s.policy->>'restrict_clipboard')::boolean,true) then decision:='restriction_disabled';counted:=false;
   elsif kind='fullscreen_exit' and (s.fullscreen_exception or not coalesce((s.policy->>'require_fullscreen')::boolean,true)) then decision:='exception';counted:=false;
   elsif cat='attention' and exists(select 1 from public.attempt_browser_sessions where attempt_id=target_attempt and browser_instance_id=browser_instance and document_id=document_instance and attention_open) then decision:='same_episode';counted:=false;
   elsif exists(select 1 from public.attempt_integrity_events where attempt_id=target_attempt and category=cat and counted=true and received_at>now()-make_interval(secs=>coalesce((s.policy->>'cooldown_seconds')::integer,10))) then decision:='cooldown';counted:=false;
   end if;
  elsif terminal then decision:='terminal';end if;
  insert into public.attempt_integrity_events(attempt_id,event_id,browser_instance_id,document_id,sequence,section_attempt_id,type,category,observed_at,severity,counted,decision)
  values(target_attempt,event_uuid,browser_instance,document_instance,seq,section_id,kind,cat,stamp,case when counted then 'warning' else 'info' end,counted,decision) on conflict do nothing;
  get diagnostics inserted=row_count;
  if inserted>0 then
   if kind in('attention_lost','fullscreen_exit') then update public.attempt_browser_sessions set attention_open=true where attempt_id=target_attempt and browser_instance_id=browser_instance and document_id=document_instance; end if;
   if kind in('attention_returned','module_ready') then update public.attempt_browser_sessions set attention_open=false where attempt_id=target_attempt and browser_instance_id=browser_instance and document_id=document_instance; end if;
   if kind='exit' then update public.attempt_browser_sessions set lifecycle='exited' where attempt_id=target_attempt and browser_instance_id=browser_instance and document_id=document_instance;end if;
  end if;
  acknowledgements:=acknowledgements||jsonb_build_array(event_uuid);
 end loop;
 select count(*)>1 into overlap from public.attempt_browser_sessions where attempt_id=target_attempt and lifecycle='active' and last_contact_at>now()-interval '60 seconds';
 had_overlap:=s.overlap_active;
 if overlap and not had_overlap and not terminal then
  counted:=coalesce((s.policy->>'enforcement')::boolean,false) and exists(select 1 from public.section_attempts sa join public.exam_sections es on es.id=sa.section_id where sa.exam_attempt_id=target_attempt and sa.status='in_progress' and sa.expires_at>now() and es.section_type='module');
  insert into public.attempt_integrity_events(attempt_id,event_id,browser_instance_id,document_id,sequence,type,category,observed_at,severity,counted,decision)
  values(target_attempt,gen_random_uuid(),browser_instance,document_instance,-1*(extract(epoch from clock_timestamp())*1000000)::bigint,'overlap','session',now(),case when counted then 'warning' else 'info' end,counted,case when counted then 'counted' else 'logging_only' end);
 end if;
 update public.attempt_integrity_state set last_contact_at=now(),overlap_active=overlap where attempt_id=target_attempt;
 perform public.recompute_integrity_summary(target_attempt);
 select * into s from public.attempt_integrity_state where attempt_id=target_attempt;
 return jsonb_build_object('enabled',true,'policy',s.policy,'fullscreenException',s.fullscreen_exception,'count',s.counted_incidents,'reviewRequired',s.review_required,'reviewCycle',s.review_cycle,'overlap',overlap,'acknowledged',acknowledgements,'serverTime',now());
end $$;

-- Server-created overlap events use negative sequence numbers.
alter table public.attempt_integrity_events drop constraint attempt_integrity_events_sequence_check;
create function public.retain_integrity_history() returns void language plpgsql security definer set search_path='' as $$ begin
 delete from public.attempt_integrity_events e using public.exam_attempts a where a.id=e.attempt_id and a.status<>'in_progress' and a.completed_at<now()-interval '90 days';
 delete from public.attempt_browser_sessions s using public.exam_attempts a where a.id=s.attempt_id and a.status<>'in_progress' and a.completed_at<now()-interval '90 days';
end $$;
revoke all on function public.snapshot_attempt_integrity(),public.recompute_integrity_summary(uuid),public.retain_integrity_history() from public,anon,authenticated;
revoke all on function public.configure_exam_integrity(uuid,jsonb,text),public.review_exam_integrity(uuid,uuid,uuid,uuid,text,text),public.integrity_sync(uuid,uuid,uuid,jsonb,boolean) from public,anon;
grant execute on function public.configure_exam_integrity(uuid,jsonb,text),public.review_exam_integrity(uuid,uuid,uuid,uuid,text,text),public.integrity_sync(uuid,uuid,uuid,jsonb,boolean) to authenticated;
-- Only summary rows are eligible for Realtime. No raw observations or notes.
do $$ begin if exists(select 1 from pg_publication where pubname='supabase_realtime') then alter publication supabase_realtime add table public.attempt_integrity_state;end if;end $$;
-- Hosted Supabase supports pg_cron; register retention when available.
do $$ begin if exists(select 1 from pg_available_extensions where name='pg_cron') then
 create extension if not exists pg_cron;
 perform cron.schedule('assessly-integrity-retention','17 3 * * *','select public.retain_integrity_history()');
end if;end $$;
