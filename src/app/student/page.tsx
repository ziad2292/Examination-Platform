import { StudentAssessments } from "@/components/student-assessments";
import { createClient } from "@/lib/supabase/server";

export default async function StudentDashboard() {
  const db = await createClient();
  const { data, error } = await db
    .from("exams")
    .select("id,title,description,status,scheduled_start_at,scheduled_end_at")
    .in("status", ["published", "closed"])
    .order("scheduled_start_at", { ascending: false });
  if (error) throw new Error("Your assessments could not be loaded.");

  const ids = (data ?? []).map((exam) => exam.id);
  const summaries = ids.length
    ? await db.rpc("student_dashboard_attempt_summaries", { target_exams: ids })
    : { data: [], error: null };
  if (summaries.error)
    throw new Error("Your assessment progress could not be loaded.");

  const byExam = new Map(
    ((summaries.data ?? []) as { exam_id: string; id: string; status: string }[]).map(
      (row) => [row.exam_id, { id: row.id, status: row.status }],
    ),
  );
  const exams = (data ?? []).map((exam) => ({
    ...exam,
    attempt: byExam.get(exam.id) ?? null,
  }));

  return (
    <div>
      <p className="eyebrow">Your learning workspace</p>
      <h1 className="mt-2 font-bold">Ready for your next step?</h1>
      <p className="mt-2 text-sm text-black/60">
        Find your assigned assessments, pick up where you left off, and check
        released results.
      </p>
      <StudentAssessments exams={exams} now={new Date().getTime()} />
    </div>
  );
}
