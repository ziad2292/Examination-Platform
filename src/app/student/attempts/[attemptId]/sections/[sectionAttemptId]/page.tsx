import { notFound, redirect } from "next/navigation";
import { BreakTimer } from "@/components/break-timer";
import { ExamRunner } from "@/components/exam-runner";
import { createClient } from "@/lib/supabase/server";
import type { SavedAnswer, StudentQuestion } from "@/lib/types";

export default async function ActiveSection({
  params,
}: {
  params: Promise<{ attemptId: string; sectionAttemptId: string }>;
}) {
  const { attemptId, sectionAttemptId } = await params;
  const supabase = await createClient();
  const { data: sectionAttempt } = await supabase
    .from("section_attempts")
    .select(
      "id,exam_attempt_id,started_at,expires_at,status,exam_sections(id,title,section_type,exam_id,exams(title))",
    )
    .eq("id", sectionAttemptId)
    .eq("exam_attempt_id", attemptId)
    .single();

  if (!sectionAttempt) notFound();
  if (sectionAttempt.status !== "in_progress") redirect(`/student/attempts/${attemptId}`);

  const { data: reconciledStatus } = await supabase.rpc("reconcile_section", {
    target_section_attempt: sectionAttemptId,
  });
  if (reconciledStatus !== "in_progress") {
    redirect(`/student/attempts/${attemptId}`);
  }

  const section = Array.isArray(sectionAttempt.exam_sections)
    ? sectionAttempt.exam_sections[0]
    : sectionAttempt.exam_sections;
  const exam = Array.isArray(section.exams) ? section.exams[0] : section.exams;

  if (section.section_type === "break") {
    return (
      <BreakTimer
        attemptId={attemptId}
        sectionAttemptId={sectionAttemptId}
        expiresAt={sectionAttempt.expires_at}
        title={section.title}
      />
    );
  }

  const [{ data: questionRows }, { data: answers }] = await Promise.all([
    supabase
      .from("questions")
      .select(
        "id,section_id,question_order,image_path,optional_text,option_a,option_b,option_c,option_d",
      )
      .eq("section_id", section.id)
      .order("question_order"),
    supabase
      .from("answers")
      .select("question_id,selected_option,marked_for_review,client_revision,updated_at")
      .eq("section_attempt_id", sectionAttemptId),
  ]);

  const questions = (questionRows ?? []) as StudentQuestion[];
  const imagePaths = questions
    .map((question) => question.image_path)
    .filter((path): path is string => Boolean(path));
  const signedImages = imagePaths.length
    ? await supabase.storage.from("question-images").createSignedUrls(imagePaths, 21_600)
    : { data: [] };
  const imageUrls = new Map(
    (signedImages.data ?? []).map((image) => [image.path, image.signedUrl]),
  );
  const securedQuestions = questions.map((question) => ({
    ...question,
    image_url: question.image_path ? imageUrls.get(question.image_path) ?? null : null,
  }));

  return (
    <ExamRunner
      attemptId={attemptId}
      sectionAttemptId={sectionAttemptId}
      expiresAt={sectionAttempt.expires_at}
      examTitle={exam.title}
      sectionTitle={section.title}
      questions={securedQuestions}
      initialAnswers={(answers ?? []) as SavedAnswer[]}
    />
  );
}
