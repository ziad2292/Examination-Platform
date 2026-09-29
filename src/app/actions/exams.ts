"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { localDateTimeToIso } from "@/lib/exam-state";
import { examSchema, questionSchema, sectionSchema } from "@/lib/validation";
import type { FormActionState } from "@/lib/form-state";

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

export async function createExam(_previous: FormActionState, formData: FormData): Promise<FormActionState> {
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
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the exam details and schedule." };

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
  if (error) return { ok: false, message: "The exam could not be created. Check the schedule and try again." };

  if (parsed.data.accessCode) {
    const codeResult = await supabase.from("exam_access_codes").insert({
      exam_id: data.id,
      access_code: parsed.data.accessCode,
    });
    if (codeResult.error) {
      await supabase.from("exams").delete().eq("id", data.id);
      return { ok: false, message: "The access code could not be saved. No partial exam was retained." };
    }
  }

  redirect(`/teacher/exams/${data.id}`);
}

export async function addSection(_previous: FormActionState, formData: FormData): Promise<FormActionState> {
  await requireRole("teacher");
  const parsed = sectionSchema.safeParse({
    examId: value(formData, "examId"),
    title: value(formData, "title"),
    sectionType: value(formData, "sectionType"),
    durationSeconds: Number(formData.get("durationMinutes")) * 60,
  });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the section details." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_section", {
    target_exam: parsed.data.examId,
    new_title: parsed.data.title,
    new_type: parsed.data.sectionType,
    new_duration_seconds: parsed.data.durationSeconds,
  });
  if (error) {
    const message = error.message.toLowerCase();
    if (message.includes("locked")) return { ok: false, message: "Sections can only be added before students begin the exam." };
    if (message.includes("not found")) return { ok: false, message: "This exam is unavailable or you no longer have access to it." };
    return { ok: false, message: "The section could not be added. Check its name and duration." };
  }
  revalidatePath(`/teacher/exams/${parsed.data.examId}`);
  return { ok: true, message: "Section added." };
}

export async function addQuestion(_previous: FormActionState, formData: FormData): Promise<FormActionState> {
  await requireRole("teacher");
  const parsed = questionSchema.safeParse({
    examId: value(formData, "examId"),
    sectionId: value(formData, "sectionId"),
    text: value(formData, "text"),
    optionA: value(formData, "optionA"),
    optionB: value(formData, "optionB"),
    optionC: value(formData, "optionC"),
    optionD: value(formData, "optionD"),
    correctOption: value(formData, "correctOption"),
  });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the question and answer choices." };
  const supabase = await createClient();
  const { data: exam } = await supabase.from("exams").select("id").eq("id", parsed.data.examId).maybeSingle();
  if (!exam) return { ok: false, message: "This exam is unavailable or you no longer have access to it." };
  const { count } = await supabase.from("exam_attempts").select("id", { count: "exact", head: true }).eq("exam_id", parsed.data.examId);
  if (count) return { ok: false, message: "Questions can only be added before students begin the exam." };
  let imagePath: string | null = null;
  const image = formData.get("image");

  if (image instanceof File && image.size) {
    const extensions: Record<string, string> = {
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/webp": "webp",
    };
    const extension = extensions[image.type];
    if (!extension) return { ok: false, message: "Use a PNG, JPEG, or WebP image." };
    if (image.size > 8 * 1024 * 1024) return { ok: false, message: "The question image must be under 8 MB." };

    imagePath = `${parsed.data.examId}/${crypto.randomUUID()}.${extension}`;
    const upload = await supabase.storage
      .from("question-images")
      .upload(imagePath, image, { contentType: image.type, upsert: false });
    if (upload.error) return { ok: false, message: "The image could not be uploaded. Try again." };
  }

  const { error } = await supabase.rpc("create_question", {
    target_exam: parsed.data.examId,
    target_section: parsed.data.sectionId,
    question_text: parsed.data.text || null,
    answer_a: parsed.data.optionA,
    answer_b: parsed.data.optionB,
    answer_c: parsed.data.optionC,
    answer_d: parsed.data.optionD,
    correct: parsed.data.correctOption,
    stored_image_path: imagePath,
  });

  if (error) {
    if (imagePath) await supabase.storage.from("question-images").remove([imagePath]);
    return { ok: false, message: error.message.toLowerCase().includes("locked") ? "Questions can only be added before students begin the exam." : "The question could not be added. Check its content and try again." };
  }
  revalidatePath(`/teacher/exams/${parsed.data.examId}`);
  return { ok: true, message: "Question added." };
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
