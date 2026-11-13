create or replace function public.integrity_sync(target_attempt uuid,browser_instance uuid,document_instance uuid,observations jsonb default '[]',registration boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.exam_attempts; s public.attempt_integrity_state; session_row public.attempt_browser_sessions; item jsonb; kind text; cat text; stamp timestamptz; v_section_attempt uuid; active_module boolean; counted boolean; decision text; event_uuid uuid; seq bigint; inserted integer; acknowledgements jsonb:='[]'; overlap boolean; had_overlap boolean; terminal boolean;
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
 if registration then update public.attempt_browser_sessions set lifecycle='exited' where attempt_id=target_attempt and browser_instance_id=browser_instance and document_id<>document_instance; end if;
 insert into public.attempt_browser_sessions(attempt_id,browser_instance_id,document_id) values(target_attempt,browser_instance,document_instance)
 on conflict(attempt_id,browser_instance_id,document_id) do update set last_contact_at=now(),lifecycle='active';
 for item in select value from jsonb_array_elements(observations) loop
  if jsonb_typeof(item)<>'object' or item-array['eventId','sequence','type','sectionAttemptId','observedAt','metadata']<>'{}' then raise exception 'Invalid event shape'; end if;
  kind:=item->>'type'; event_uuid:=(item->>'eventId')::uuid;seq:=(item->>'sequence')::bigint;stamp:=(item->>'observedAt')::timestamptz;v_section_attempt:=nullif(item->>'sectionAttemptId','')::uuid;
  if event_uuid is null or seq is null or seq<0 or stamp is null or kind is null or kind not in('attention_lost','attention_returned','fullscreen_exit','clipboard','shortcut','offline','reconnect','reload','exit','overflow','module_ready') or stamp>now()+interval '5 seconds' then raise exception 'Invalid observation'; end if;
  if coalesce(item->'metadata','{}')<>'{}' then raise exception 'Observation metadata must be empty'; end if;
  if exists(select 1 from public.attempt_integrity_events where attempt_id=target_attempt and (event_id=event_uuid or (browser_instance_id=browser_instance and document_id=document_instance and sequence=seq))) then acknowledgements:=acknowledgements||jsonb_build_array(event_uuid);continue;end if;
  active_module:=false;
  if v_section_attempt is not null then
   select sa.status='in_progress' and sa.expires_at>now() and es.section_type='module' into active_module from public.section_attempts sa join public.exam_sections es on es.id=sa.section_id where sa.id=v_section_attempt and sa.exam_attempt_id=target_attempt;
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
   elsif exists(select 1 from public.attempt_integrity_events e where e.attempt_id=target_attempt and e.category=cat and e.counted=true and e.received_at>now()-make_interval(secs=>coalesce((s.policy->>'cooldown_seconds')::integer,10))) then decision:='cooldown';counted:=false;
   end if;
  elsif terminal then decision:='terminal';end if;
  insert into public.attempt_integrity_events(attempt_id,event_id,browser_instance_id,document_id,sequence,section_attempt_id,type,category,observed_at,severity,counted,decision)
  values(target_attempt,event_uuid,browser_instance,document_instance,seq,v_section_attempt,kind,cat,stamp,case when counted then 'warning' else 'info' end,counted,decision) on conflict do nothing;
  get diagnostics inserted=row_count;
  if inserted>0 then
   if kind in('attention_lost','fullscreen_exit') then update public.attempt_browser_sessions set attention_open=true where attempt_id=target_attempt and browser_instance_id=browser_instance and document_id=document_instance; end if;
   if kind in('attention_returned','module_ready') then update public.attempt_browser_sessions set attention_open=false where attempt_id=target_attempt and browser_instance_id=browser_instance and document_id=document_instance; end if;
   if kind='exit' then update public.attempt_browser_sessions set lifecycle='exited' where attempt_id=target_attempt and browser_instance_id=browser_instance and document_id=document_instance;end if;
  end if;
  acknowledgements:=acknowledgements||jsonb_build_array(event_uuid);
 end loop;
 select count(distinct browser_instance_id)>1 into overlap from public.attempt_browser_sessions where attempt_id=target_attempt and lifecycle='active' and last_contact_at>now()-interval '60 seconds';
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
