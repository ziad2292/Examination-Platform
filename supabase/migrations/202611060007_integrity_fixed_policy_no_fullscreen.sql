-- Remove fullscreen enforcement without deleting historical observations.
-- Thresholds are application constants, not per-exam teacher settings.
create function public.integrity_policy_constants() returns jsonb
language sql immutable set search_path='' as $$
 select '{"threshold":3,"cooldown_seconds":10,"attention_seconds":2,"heartbeat_seconds":20,"stale_seconds":60,"delayed_seconds":30,"queue_limit":200,"retention_days":90}'::jsonb
$$;
revoke all on function public.integrity_policy_constants() from public,anon,authenticated;

create function public.admin_integrity_policy() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_active_user() or not public.is_superadmin() then raise exception 'Administrator access required' using errcode='42501';end if;
 return public.integrity_policy_constants();
end $$;
revoke all on function public.admin_integrity_policy() from public,anon;
grant execute on function public.admin_integrity_policy() to authenticated;

create or replace function public.configure_exam_integrity(target_exam uuid,settings jsonb,change_reason text default null) returns void
language plpgsql security definer set search_path='' as $$
declare constants jsonb:=public.integrity_policy_constants();
begin
 perform 1 from public.exams where id=target_exam for update;
 if not public.is_active_user() or not(public.owns_exam(target_exam) or public.is_superadmin()) then raise exception 'Exam not found' using errcode='42501'; end if;
 if jsonb_typeof(settings) is distinct from 'object' or settings-array['enabled','restrict_clipboard','enforcement','require_fullscreen','threshold','cooldown_seconds']<>'{}' then raise exception 'Invalid settings';end if;
 if jsonb_typeof(settings->'enabled') is distinct from 'boolean' or jsonb_typeof(settings->'restrict_clipboard') is distinct from 'boolean' or jsonb_typeof(settings->'enforcement') is distinct from 'boolean' then raise exception 'Invalid monitoring options';end if;
 -- Legacy request fields remain accepted, but cannot change the fixed policy.
 insert into public.exam_integrity_settings(exam_id,enabled,require_fullscreen,restrict_clipboard,threshold,cooldown_seconds,enforcement)
 values(target_exam,(settings->>'enabled')::boolean,false,(settings->>'restrict_clipboard')::boolean,(constants->>'threshold')::integer,(constants->>'cooldown_seconds')::integer,(settings->>'enforcement')::boolean)
 on conflict(exam_id) do update set enabled=excluded.enabled,require_fullscreen=false,restrict_clipboard=excluded.restrict_clipboard,threshold=excluded.threshold,cooldown_seconds=excluded.cooldown_seconds,enforcement=excluded.enforcement,version=public.exam_integrity_settings.version+1,updated_at=now();
 -- Audit identity and changed settings automatically; no reason input required.
 insert into public.integrity_review_actions(exam_id,action,reason,actor_id) values(target_exam,'settings','Monitoring options updated',auth.uid());
end $$;

create or replace function public.snapshot_attempt_integrity() returns trigger
language plpgsql security definer set search_path='' as $$
declare settings public.exam_integrity_settings;
begin
 select * into settings from public.exam_integrity_settings where exam_id=new.exam_id;
 insert into public.attempt_integrity_state(attempt_id,exam_id,policy,fullscreen_exception)
 values(new.id,new.exam_id,coalesce(to_jsonb(settings),'{}')||public.integrity_policy_constants()||jsonb_build_object('enabled',coalesce(settings.enabled,false),'require_fullscreen',false),false);
 return new;
end $$;
alter table public.exam_integrity_settings alter column require_fullscreen set default false;
update public.exam_integrity_settings set require_fullscreen=false;
-- Fullscreen is removed for active and future attempts. Keep old counts,
-- evidence, and threshold snapshots intact; never rewrite grades or reviews.
update public.attempt_integrity_state set policy=jsonb_set(policy,'{require_fullscreen}','false'::jsonb);

alter function public.integrity_sync(uuid,uuid,uuid,jsonb,boolean) rename to process_integrity_batch;
revoke all on function public.process_integrity_batch(uuid,uuid,uuid,jsonb,boolean) from public,anon,authenticated;
create function public.integrity_sync(target_attempt uuid,browser_instance uuid,document_instance uuid,observations jsonb default '[]',registration boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare filtered jsonb; ignored jsonb; result jsonb;
begin
 if jsonb_typeof(observations) is distinct from 'array' or jsonb_array_length(observations)>50 or octet_length(observations::text)>32768 then raise exception 'Invalid observation batch';end if;
 -- Acknowledge old-client fullscreen observations without logging, counting,
 -- or opening an attention episode. The core RPC still authorizes the attempt.
 select coalesce(jsonb_agg(e),'[]') into filtered from jsonb_array_elements(observations) e where e->>'type' is distinct from 'fullscreen_exit';
 select coalesce(jsonb_agg(e->'eventId'),'[]') into ignored from jsonb_array_elements(observations) e where e->>'type'='fullscreen_exit';
 result:=public.process_integrity_batch(target_attempt,browser_instance,document_instance,filtered,registration);
 return jsonb_set(result,'{acknowledged}',coalesce(result->'acknowledged','[]')||ignored);
end $$;
revoke all on function public.integrity_sync(uuid,uuid,uuid,jsonb,boolean) from public,anon;
grant execute on function public.integrity_sync(uuid,uuid,uuid,jsonb,boolean) to authenticated;

create or replace function public.review_exam_integrity(target_exam uuid,target_attempt uuid,target_student uuid,target_event uuid,review_action text,change_reason text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not public.is_active_user() or not(public.owns_exam(target_exam) or public.is_superadmin()) then raise exception 'Exam not found' using errcode='42501';end if;
 if review_action is null or review_action not in('dismiss','reinstate','note') then raise exception 'Unsupported review action';end if;
 if length(trim(coalesce(change_reason,''))) not between 3 and 1000 then raise exception 'Review explanation required';end if;
 perform 1 from public.attempt_integrity_state where attempt_id=target_attempt and exam_id=target_exam for update;
 if not found then raise exception 'Attempt not found';end if;
 if review_action<>'note' and not exists(select 1 from public.attempt_integrity_events where attempt_id=target_attempt and event_id=target_event) then raise exception 'Event not found';end if;
 insert into public.integrity_review_actions(exam_id,attempt_id,event_id,action,reason,actor_id)
 values(target_exam,target_attempt,target_event,review_action,change_reason,auth.uid());
 perform public.recompute_integrity_summary(target_attempt);
end $$;
