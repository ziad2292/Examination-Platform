"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { localDateTimeToIso } from "@/lib/exam-state";
import { examSchema, questionSchema, sectionSchema } from "@/lib/validation";

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

async function assertMutable(examId: string) {
  const supabase = await createClient();
  const { data: exam } = await supabase
    .from("exams")
    .select("id")
    .eq("id", examId)
    .single();
  if (!exam) throw new Error("Exam not found.");

  const { count } = await supabase
    .from("exam_attempts")
    .select("id", { count: "exact", head: true })
    .eq("exam_id", examId);
  if (count) throw new Error("Exam content is locked because a student has started it.");
  return supabase;
}

export async function createExam(formData: FormData) {
  const viewer = await requireRole("teacher");
  const startOffsetValue = value(formData, "scheduledStartOffset");
  const endOffsetValue = value(formData, "scheduledEndOffset");
  const scheduledStartAt = localDateTimeToIso(
    value(formData, "scheduledStartAt"),
    startOffsetValue === "" ? Number.NaN : Number(startOffsetValue),
  );
  const scheduledEndAt = localDateTimeToIso(
    value(formData, "scheduledEndAt"),
    endOffsetValue === "" ? Number.NaN : Number(endOffsetValue),
  );
  const parsed = examSchema.safeParse({
    title: value(formData, "title"),
    description: value(formData, "description"),
    instructions: value(formData, "instructions"),
    accessCode: value(formData, "accessCode"),
    scheduledStartAt,
    scheduledEndAt,
  });
  if (!parsed.success) redirect("/teacher/exams/new?error=invalid_details");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("exams")
    .insert({
      title: parsed.data.title,
      description: parsed.data.description || null,
      instructions: parsed.data.instructions || null,
      access_code_required: Boolean(parsed.data.accessCode),
      scheduled_start_at: parsed.data.scheduledStartAt,
      scheduled_end_at: parsed.data.scheduledEndAt,
      created_by: viewer.id,
    })
    .select("id")
    .single();
  if (error) redirect("/teacher/exams/new?error=create_failed");

  if (parsed.data.accessCode) {
    const codeResult = await supabase.from("exam_access_codes").insert({
      exam_id: data.id,
      access_code: parsed.data.accessCode,
    });
    if (codeResult.error) {
      await supabase.from("exams").delete().eq("id", data.id);
      redirect("/teacher/exams/new?error=create_failed");
    }
  }

  redirect(`/teacher/exams/${data.id}`);
}

export async function addSection(formData: FormData) {
  await requireRole("teacher");
  const parsed = sectionSchema.parse({
    examId: value(formData, "examId"),
    title: value(formData, "title"),
    sectionType: value(formData, "sectionType"),
    durationSeconds: Number(formData.get("durationMinutes")) * 60,
  });
  const supabase = await assertMutable(parsed.examId);
  const { error } = await supabase.rpc("create_section", {
    target_exam: parsed.examId,
    new_title: parsed.title,
    new_type: parsed.sectionType,
    new_duration_seconds: parsed.durationSeconds,
  });
  if (error) throw new Error("Section could not be added.");
  revalidatePath(`/teacher/exams/${parsed.examId}`);
}

export async function addQuestion(formData: FormData) {
  await requireRole("teacher");
  const parsed = questionSchema.parse({
    examId: value(formData, "examId"),
    sectionId: value(formData, "sectionId"),
    text: value(formData, "text"),
    optionA: value(formData, "optionA"),
    optionB: value(formData, "optionB"),
    optionC: value(formData, "optionC"),
    optionD: value(formData, "optionD"),
    correctOption: value(formData, "correctOption"),
  });
  const supabase = await assertMutable(parsed.examId);
  let imagePath: string | null = null;
  const image = formData.get("image");

  if (image instanceof File && image.size) {
    const extensions: Record<string, string> = {
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/webp": "webp",
    };
    const extension = extensions[image.type];
    if (!extension) throw new Error("Use a PNG, JPEG, or WebP image.");
    if (image.size > 8 * 1024 * 1024) throw new Error("Image must be under 8 MB.");

    imagePath = `${parsed.examId}/${crypto.randomUUID()}.${extension}`;
    const upload = await supabase.storage
      .from("question-images")
      .upload(imagePath, image, { contentType: image.type, upsert: false });
    if (upload.error) throw new Error("Image could not be uploaded.");
  }

  const { error } = await supabase.rpc("create_question", {
    target_exam: parsed.examId,
    target_section: parsed.sectionId,
    question_text: parsed.text || null,
    answer_a: parsed.optionA,
    answer_b: parsed.optionB,
    answer_c: parsed.optionC,
    answer_d: parsed.optionD,
    correct: parsed.correctOption,
    stored_image_path: imagePath,
  });

  if (error) {
    if (imagePath) await supabase.storage.from("question-images").remove([imagePath]);
    throw new Error("Question could not be added.");
  }
  revalidatePath(`/teacher/exams/${parsed.examId}`);
}

export async function moveBuilderItem(formData: FormData) {
  await requireRole("teacher");
  const examId = value(formData, "examId");
  const kind = value(formData, "kind");
  const id = value(formData, "id");
  const direction = Number(formData.get("direction"));
  if (!["section", "question"].includes(kind) || ![-1, 1].includes(direction)) {
    throw new Error("Invalid reorder request");
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc(
    kind === "section" ? "move_section" : "move_question",
    kind === "section" ? { target_section: id, direction } : { target_question: id, direction },
  );
  if (error) throw new Error("Item could not be moved.");
  revalidatePath(`/teacher/exams/${examId}`);
}

export async function deleteQuestion(formData: FormData) {
  await requireRole("teacher");
  const examId = value(formData, "examId");
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_question", {
    target_question: value(formData, "questionId"),
  });
  if (error) throw new Error("Question could not be deleted.");
  revalidatePath(`/teacher/exams/${examId}`);
}
