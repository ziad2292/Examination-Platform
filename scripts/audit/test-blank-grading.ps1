$ErrorActionPreference = 'Stop'
$container = 'assessly-blank-grading-disposable'
$image = 'postgres:18-alpine'

if ((docker ps -a --format '{{.Names}}') -contains $container) {
  throw 'Disposable grading test container already exists; inspect it before rerunning.'
}

try {
  docker run -d --rm --name $container --network none -e POSTGRES_PASSWORD=disposable-only $image | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not start disposable PostgreSQL.' }
  $ready = $false
  for ($i = 0; $i -lt 30; $i++) {
    docker exec $container pg_isready -U postgres -d postgres 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) { throw 'Disposable PostgreSQL did not become ready.' }

  $fixture = @'
create role anon;
create role authenticated;
create table public.answers(id uuid primary key,exam_attempt_id uuid,question_id uuid,selected_option text);
create table public.question_keys(question_id uuid primary key,correct_option text not null);
create table public.answer_results(answer_id uuid primary key,is_correct boolean not null,graded_at timestamptz not null default now());
create table public.exam_attempts(id uuid primary key,exam_id uuid,raw_score integer,total_questions integer);
create table public.exam_sections(id uuid primary key,exam_id uuid);
create table public.questions(id uuid primary key,section_id uuid);
insert into public.exam_attempts(id,exam_id) values('a0000000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000001');
insert into public.exam_sections(id,exam_id) values('b0000000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000001');
insert into public.questions(id,section_id) values
 ('c0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001'),
 ('c0000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000001'),
 ('c0000000-0000-4000-8000-000000000003','b0000000-0000-4000-8000-000000000001');
insert into public.question_keys(question_id,correct_option) values
 ('c0000000-0000-4000-8000-000000000001','A'),
 ('c0000000-0000-4000-8000-000000000002','B'),
 ('c0000000-0000-4000-8000-000000000003','C');
insert into public.answers(id,exam_attempt_id,question_id,selected_option) values
 ('d0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000001','A'),
 ('d0000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000002',null);
'@
  $fixture | docker exec -i $container psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1
  if ($LASTEXITCODE -ne 0) { throw 'Fixture setup failed.' }
  Get-Content 'supabase/migrations/202611270002_grade_blank_saved_answers.sql' -Raw |
    docker exec -i $container psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1
  if ($LASTEXITCODE -ne 0) { throw 'Migration application failed.' }

  $assertion = @'
select public.recalculate_attempt_score('a0000000-0000-4000-8000-000000000001');
do $$ begin
  if (select row(raw_score,total_questions) from public.exam_attempts where id='a0000000-0000-4000-8000-000000000001') is distinct from row(1,3) then
    raise exception 'Unexpected score for correct, blank, and absent answers';
  end if;
  if (select is_correct from public.answer_results where answer_id='d0000000-0000-4000-8000-000000000002') is distinct from false then
    raise exception 'Saved blank answer was not graded false';
  end if;
end $$;
update public.question_keys set correct_option='D' where question_id='c0000000-0000-4000-8000-000000000001';
select public.recalculate_attempt_score('a0000000-0000-4000-8000-000000000001');
do $$ begin
  if (select row(raw_score,total_questions) from public.exam_attempts where id='a0000000-0000-4000-8000-000000000001') is distinct from row(0,3) then
    raise exception 'Regrading did not update the score deterministically';
  end if;
end $$;
'@
  $assertion | docker exec -i $container psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1
  if ($LASTEXITCODE -ne 0) { throw 'Grading assertions failed.' }
  Write-Host 'Disposable blank-answer and regrading assertions passed.'
} finally {
  if ((docker ps -a --format '{{.Names}}') -contains $container) {
    docker stop $container | Out-Null
  }
}
