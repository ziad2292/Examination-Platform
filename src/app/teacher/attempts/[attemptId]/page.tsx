import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

type Question = {
  id: string;
  question_order: number;
  optional_text: string | null;
  exam_sections: { title: string; section_order: number };
  question_keys: { correct_option: string } | { correct_option: string }[];
};
type Answer = {
  question_id: string;
  selected_option: string | null;
  marked_for_review: boolean;
  answer_results: { is_correct: boolean } | { is_correct: boolean }[] | null;
};

export default async function AttemptDetail({
  params,
}: {
  params: Promise<{ attemptId: string }>;
}) {
  const { attemptId } = await params;
  const supabase = await createClient();
  const { data: attempt } = await supabase
    .from("exam_attempts")
    .select("*,profiles!exam_attempts_student_id_fkey(full_name),exams(id,title)")
    .eq("id", attemptId)
    .single();
  if (!attempt) notFound();

  const exam = Array.isArray(attempt.exams) ? attempt.exams[0] : attempt.exams;
  const [{ data: questionData }, { data: answerData }] = await Promise.all([
    supabase
      .from("questions")
      .select(
        "id,question_order,optional_text,exam_sections!inner(title,section_order,exam_id),question_keys(correct_option)",
      )
      .eq("exam_sections.exam_id", exam.id),
    supabase
      .from("answers")
      .select("question_id,selected_option,marked_for_review,answer_results(is_correct)")
      .eq("exam_attempt_id", attemptId),
  ]);
  const questions = ((questionData ?? []) as unknown as Question[]).sort(
    (left, right) =>
      left.exam_sections.section_order - right.exam_sections.section_order ||
      left.question_order - right.question_order,
  );
  const answers = (answerData ?? []) as unknown as Answer[];
  const byQuestion = new Map(answers.map((answer) => [answer.question_id, answer]));
  const profile = Array.isArray(attempt.profiles) ? attempt.profiles[0] : attempt.profiles;

  return (
    <div>
      <p className="eyebrow">Attempt review</p>
      <h1 className="mt-2 text-3xl font-bold">
        {profile.full_name} · {exam.title}
      </h1>
      <p className="mt-2 text-black/50">
        Raw score: {attempt.raw_score ?? "Pending"} /{" "}
        {attempt.total_questions ?? questions.length}
      </p>
      <div className="mt-8 space-y-3">
        {questions.map((question) => {
          const answer = byQuestion.get(question.id);
          const result = answer
            ? Array.isArray(answer.answer_results)
              ? answer.answer_results[0]
              : answer.answer_results
            : null;
          const key = Array.isArray(question.question_keys)
            ? question.question_keys[0]
            : question.question_keys;
          return (
            <article className="card flex flex-wrap items-center gap-4 p-5" key={question.id}>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold uppercase text-black/40">
                  {question.exam_sections.title} · Question {question.question_order}
                </p>
                <p className="mt-1 truncate font-medium">
                  {question.optional_text || "Image-based question"}
                </p>
              </div>
              <span className="text-sm">
                Selected: <b>{answer?.selected_option ?? "Unanswered"}</b>
              </span>
              <span className="text-sm">
                Correct: <b>{key?.correct_option}</b>
              </span>
              {answer?.marked_for_review && (
                <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-bold">
                  Marked
                </span>
              )}
              <span
                className={`rounded-full px-3 py-1 text-xs font-bold ${
                  result?.is_correct
                    ? "bg-green-100 text-green-800"
                    : "bg-red-100 text-red-700"
                }`}
              >
                {result?.is_correct
                  ? "Correct"
                  : answer?.selected_option
                    ? "Incorrect"
                    : "Unanswered"}
              </span>
            </article>
          );
        })}
      </div>
    </div>
  );
}
