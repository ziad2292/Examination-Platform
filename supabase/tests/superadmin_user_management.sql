begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

select results_eq(
  $$select role::text,is_active from public.profiles where email='admin@example.com'$$,
  $$select 'superadmin'::text,true$$,
  'local seed includes one active Super Admin'
);

set local role authenticated;
select set_config('request.jwt.claim.sub','90000000-0000-0000-0000-000000000001',true);
select ok(public.is_superadmin(),'seeded Super Admin is recognized by database authorization');
select is((select count(*)::integer from public.profiles),7,'Super Admin RLS can list all users');
select is((select count(*)::integer from public.admin_user_history_summary()),7,'Super Admin can inspect safe deletion history');

reset role;
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,confirmation_token,recovery_token,email_change_token_new,email_change,email_change_token_current,phone_change,phone_change_token,reauthentication_token,created_at,updated_at,raw_app_meta_data,raw_user_meta_data) values
('00000000-0000-0000-0000-000000000000','91000000-0000-0000-0000-000000000001','authenticated','authenticated','managed.student@example.com',crypt('ManagedLocal123!',gen_salt('bf')),now(),'','','','','','','','',now(),now(),'{"provider":"email","providers":["email"]}','{"managed_by_superadmin":true,"full_name":"Managed Student","role":"student"}'),
('00000000-0000-0000-0000-000000000000','91000000-0000-0000-0000-000000000002','authenticated','authenticated','managed.teacher@example.com',crypt('ManagedLocal123!',gen_salt('bf')),now(),'','','','','','','','',now(),now(),'{"provider":"email","providers":["email"]}','{"managed_by_superadmin":true,"full_name":"Managed Teacher","role":"teacher"}');
select is(
  (select count(*)::integer from public.profiles where id::text like '91000000-%'),
  0,
  'untrusted Auth metadata cannot provision application profiles'
);
insert into public.profiles(id,full_name,email,role) values
('91000000-0000-0000-0000-000000000001','Managed Student','managed.student@example.com','student'),
('91000000-0000-0000-0000-000000000002','Managed Teacher','managed.teacher@example.com','teacher');
select results_eq(
  $$select email,role::text from public.profiles where id::text like '91000000-%' order by email$$,
  $$values ('managed.student@example.com','student'),('managed.teacher@example.com','teacher')$$,
  'server-provisioned student and teacher profiles have correct roles'
);
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,confirmation_token,recovery_token,email_change_token_new,email_change,email_change_token_current,phone_change,phone_change_token,reauthentication_token,created_at,updated_at,raw_app_meta_data,raw_user_meta_data) values
('00000000-0000-0000-0000-000000000000','91000000-0000-0000-0000-000000000003','authenticated','authenticated','another.auth@example.com',crypt('ManagedLocal123!',gen_salt('bf')),now(),'','','','','','','','',now(),now(),'{"provider":"email","providers":["email"]}','{}');
select throws_ok($$
  insert into public.profiles(id,full_name,email,role) values
  ('91000000-0000-0000-0000-000000000003','Duplicate Student','MANAGED.STUDENT@example.com','student')
$$,'23505',null,'duplicate profile email is rejected case-insensitively');

set local role authenticated;
select set_config('request.jwt.claim.sub','90000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.admin_update_user_profile('91000000-0000-0000-0000-000000000001','Renamed Student','renamed.student@example.com','student',true,'Correct account details','92000000-0000-4000-8000-000000000001')$$,'Super Admin can update an eligible user');
select results_eq($$select full_name,email from public.profiles where id='91000000-0000-0000-0000-000000000001'$$,$$values ('Renamed Student','renamed.student@example.com')$$,'user details are updated');
select lives_ok($$select public.admin_update_user_profile('91000000-0000-0000-0000-000000000001','Renamed Student','renamed.student@example.com','student',false,'Suspend account access','92000000-0000-4000-8000-000000000002')$$,'Super Admin can deactivate a user');
select is((select is_active from public.profiles where id='91000000-0000-0000-0000-000000000001'),false,'deactivation is stored');
select set_config('request.jwt.claim.sub','91000000-0000-0000-0000-000000000001',true);
select is((select count(*)::integer from public.profiles),0,'inactive session cannot read application profiles');
select throws_ok($$select public.start_exam('30000000-0000-0000-0000-000000000001',null)$$,'P0001','Account is inactive','inactive session cannot mutate through student RPCs');

select set_config('request.jwt.claim.sub','90000000-0000-0000-0000-000000000001',true);
select throws_ok($$select public.admin_update_user_profile('90000000-0000-0000-0000-000000000001','Local Super Admin','admin@example.com','teacher',true,'Unsafe demotion','92000000-0000-4000-8000-000000000003')$$,'P0001','Cannot remove the last active Super Admin','last active Super Admin cannot be demoted');

reset role;
insert into public.exam_attempts(exam_id,student_id) values('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001');
set local role authenticated;
select set_config('request.jwt.claim.sub','90000000-0000-0000-0000-000000000001',true);
select throws_ok($$select public.admin_assert_user_deletable('20000000-0000-0000-0000-000000000001')$$,'P0001','User has historical data and must be deactivated','hard deletion rejects a user with attempts');
select throws_ok($$select public.admin_update_user_profile('20000000-0000-0000-0000-000000000001','Jamie Chen','student1@example.com','teacher',true,'Unsafe history role change','92000000-0000-4000-8000-000000000004')$$,'P0001','Role cannot change after historical exam activity','role changes reject users with exam history');
select ok(public.admin_assert_user_deletable('91000000-0000-0000-0000-000000000002'),'history-free account is eligible for hard deletion');

reset role;
delete from auth.users where id='91000000-0000-0000-0000-000000000002';
select is((select count(*)::integer from public.profiles where id='91000000-0000-0000-0000-000000000002'),0,'Auth deletion cascades the eligible profile without orphans');

set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select ok(not public.is_superadmin(),'teacher is not a Super Admin');
select throws_ok($$select * from public.admin_user_history_summary()$$,'P0001','Super Admin access required','teacher cannot invoke user-management RPCs');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select ok(not public.is_superadmin(),'student is not a Super Admin');
select throws_ok($$select public.admin_assert_user_deletable('91000000-0000-0000-0000-000000000001')$$,'P0001','Super Admin access required','student cannot invoke deletion authorization');

select * from finish();
rollback;
