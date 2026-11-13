alter table public.attempt_integrity_state add column retained_count integer not null default 0;
alter table public.integrity_review_actions alter column created_at set default clock_timestamp();

create or replace function public.recompute_integrity_summary(target_attempt uuid) returns void language plpgsql security definer set search_path='' as $$
declare total integer; s public.attempt_integrity_state; flagged boolean;
begin
 select * into s from public.attempt_integrity_state where attempt_id=target_attempt for update;
 select count(*) into total from public.attempt_integrity_events e where e.attempt_id=target_attempt and e.counted and coalesce((select r.action from public.integrity_review_actions r where r.attempt_id=target_attempt and r.event_id=e.event_id and r.action in('dismiss','reinstate') order by r.created_at desc,r.id desc limit 1),'reinstate')<>'dismiss';
 total:=total+s.retained_count;
 flagged:=total>=coalesce((s.policy->>'threshold')::integer,3);
 update public.attempt_integrity_state set counted_incidents=total,review_required=flagged,
 flagged_at=case when flagged and not s.review_required then clock_timestamp() when flagged then s.flagged_at else null end,
 review_cycle=review_cycle+case when flagged and not s.review_required then 1 else 0 end,revision=revision+1 where attempt_id=target_attempt;
end $$;
create or replace function public.retain_integrity_history() returns void language plpgsql security definer set search_path='' as $$ begin
 -- Lock summaries before removing raw evidence; retain effective aggregates.
 perform s.attempt_id from public.attempt_integrity_state s join public.exam_attempts a on a.id=s.attempt_id where a.status<>'in_progress' and a.completed_at<now()-interval '90 days' for update of s;
 update public.attempt_integrity_state s set retained_count=counted_incidents from public.exam_attempts a where a.id=s.attempt_id and a.status<>'in_progress' and a.completed_at<now()-interval '90 days';
 delete from public.attempt_integrity_events e using public.exam_attempts a where a.id=e.attempt_id and a.status<>'in_progress' and a.completed_at<now()-interval '90 days';
 delete from public.attempt_browser_sessions s using public.exam_attempts a where a.id=s.attempt_id and a.status<>'in_progress' and a.completed_at<now()-interval '90 days';
end $$;
create function public.copy_exam_integrity_settings() returns trigger language plpgsql security definer set search_path='' as $$ begin
 if new.status='completed' and old.status is distinct from new.status then
 insert into public.exam_integrity_settings(exam_id,enabled,require_fullscreen,restrict_clipboard,threshold,cooldown_seconds,enforcement)
 select new.target_exam_id,enabled,require_fullscreen,restrict_clipboard,threshold,cooldown_seconds,enforcement from public.exam_integrity_settings where exam_id=new.source_exam_id on conflict do nothing;
 end if;return new;
end $$;
create trigger copy_exam_integrity_settings after update on public.exam_duplication_jobs for each row execute function public.copy_exam_integrity_settings();
create function public.audit_integrity_review() returns trigger language plpgsql security definer set search_path='' as $$ begin
 insert into public.admin_audit_events(actor_id,action,target_type,target_id,exam_id,reason,after_state)
 values(new.actor_id,'integrity.'||new.action,'exam',new.exam_id,new.exam_id,new.reason,jsonb_build_object('reviewId',new.id,'attemptId',new.attempt_id,'eventId',new.event_id,'studentId',new.student_id));
 return new;
end $$;
create trigger audit_integrity_review after insert on public.integrity_review_actions for each row execute function public.audit_integrity_review();
revoke all on function public.copy_exam_integrity_settings(),public.audit_integrity_review() from public,anon,authenticated;
