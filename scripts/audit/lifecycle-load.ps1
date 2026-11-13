param([Parameter(Mandatory=$true)][string]$Container)
$ErrorActionPreference='Stop'
if ($Container -notmatch '^assessly-audit-[a-f0-9]{32}$') { throw 'Disposable audit container required' }
$network=docker inspect $Container --format '{{.HostConfig.NetworkMode}}'
if ($network -ne 'none') { throw 'Workload requires network isolation' }
$directory=Join-Path $PSScriptRoot '../../docs/audits/production-readiness/evidence'
function Sql([string]$query) {
  $output=$query | docker exec -i $Container psql -U postgres -d postgres -X -q -A -t -v ON_ERROR_STOP=1 2>&1
  if ($LASTEXITCODE -ne 0) { throw ($output | Out-String) }
  return $output
}
Sql @'
insert into auth.users(id,email) select md5('audit-load-student-'||i)::uuid,'audit-load-'||i||'@example.test' from generate_series(0,199)i;
insert into public.profiles(id,full_name,email,role,teacher_id)
select id,'Audit load student',email,'student','10000000-0000-0000-0000-000000000001' from auth.users where email like 'audit-load-%@example.test';
'@ | Out-Null
$results=@()
foreach ($clients in @(50,100,200)) {
  $exam=Sql "select md5('audit-load-exam-$clients')::uuid;"
  $section=Sql "select md5('audit-load-section-$clients')::uuid;"
  $question=Sql "select md5('audit-load-question-$clients-1')::uuid;"
  Sql @"
insert into public.exams(id,title,status,scheduled_start_at,scheduled_end_at,created_by)
values('$exam','Disposable load $clients','draft',now()-interval '1 hour',now()+interval '1 hour','10000000-0000-0000-0000-000000000001');
insert into public.exam_sections(id,exam_id,title,section_type,section_order,duration_seconds) values('$section','$exam','Module','module',1,600);
insert into public.questions(id,section_id,question_order,optional_text,option_a,option_b,option_c,option_d)
select md5('audit-load-question-$clients-'||i)::uuid,'$section',i,'Load question','Correct','Wrong','Wrong','Wrong' from generate_series(1,20)i;
insert into public.question_keys(question_id,correct_option) select id,'A' from public.questions where section_id='$section';
insert into public.exam_student_assignments(exam_id,student_id,assigned_by)
select '$exam',md5('audit-load-student-'||i)::uuid,'10000000-0000-0000-0000-000000000001' from generate_series(0,$($clients-1))i;
update public.exams set status='published',published_at=now() where id='$exam';
"@ | Out-Null
  $attempt="(select id from public.exam_attempts where student_id=auth.uid() and exam_id='$exam')"
  $sectionAttempt="(select id from public.section_attempts where exam_attempt_id=$attempt and section_id='$section')"
  $operations=@{
    start="select public.start_exam('$exam',null);"
    module="select public.start_section($attempt,'$section');"
    save="\set revision :revision + 1`nselect public.save_answer($sectionAttempt,'$question','A',false,:revision);"
    submit="select public.submit_section($sectionAttempt);"
  }
  foreach ($phase in @('start','module','save','submit')) {
    $script="select set_config('request.jwt.claim.sub',md5('audit-load-student-'||:client_id)::uuid::text,false);`nset role authenticated;`n"+$operations[$phase]
    $script | docker exec -i $Container sh -c 'cat > /tmp/audit-workload.sql'
    $iterations=if($phase -eq 'save'){20}else{1}
    $prefix="/tmp/audit-$clients-$phase"
    $output=docker exec $Container pgbench -U postgres -d postgres -n -c $clients -j 4 -t $iterations -D revision=0 -f /tmp/audit-workload.sql -l --log-prefix=$prefix -r 2>&1
    $code=$LASTEXITCODE
    $output | Set-Content (Join-Path $directory "load-$clients-$phase.txt")
    if ($code -ne 0 -or ($output -join "`n") -match 'ERROR|FATAL|aborted') { throw "Workload failed $clients/$phase" }
    $lines=docker exec $Container sh -c "cat $prefix.*"
    $samples=@($lines | ForEach-Object { $fields=$_ -split '\s+'; [double]$fields[2]/1000 } | Sort-Object)
    if ($samples.Count -ne $clients*$iterations) { throw 'Unexpected workload transaction count' }
    $results += [pscustomobject]@{students=$clients;phase=$phase;requests=$samples.Count;p50Ms=$samples[[math]::Ceiling($samples.Count*.5)-1];p95Ms=$samples[[math]::Ceiling($samples.Count*.95)-1];p99Ms=$samples[[math]::Ceiling($samples.Count*.99)-1]}
  }
  $correct=Sql "select count(*) from public.exam_attempts where exam_id='$exam' and status='completed' and raw_score=1 and total_questions=20;"
  $saved=Sql "select count(*) from public.answers where exam_attempt_id in (select id from public.exam_attempts where exam_id='$exam') and selected_option='A' and client_revision=20;"
  if ([int]$correct -ne $clients -or [int]$saved -ne $clients) { throw 'Workload persisted-answer or grading verification failed' }
}
$results | ConvertTo-Json | Set-Content (Join-Path $directory 'lifecycle-load.json')
$results | Format-Table
