"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { localDateTimeToIso } from "@/lib/exam-state";
import { createClient } from "@/lib/supabase/server";

const idSchema = z.guid();
const optionSchema = z.enum(["A", "B", "C", "D"]);

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function operationKey(formData: FormData) {
  const parsed = idSchema.safeParse(value(formData, "operationKey"));
  return parsed.success ? parsed.data : crypto.randomUUID();
}

function scheduleValue(formData: FormData, field: string) {
  const offset = Number(value(formData, `${field}Offset`));
  return localDateTimeToIso(value(formData, field), offset);
}

function adminErrorPath(examId: string, code: string) {
  return `/teacher/exams/${examId}?error=${code}`;
}

async function stablePathToken(valueToHash: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(valueToHash)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

export async function updateExamMetadata(formData: FormData) {
  await requireRole("teacher");
  const parsed = z
    .object({
      examId: idSchema,
      title: z.string().min(3).max(120),
      description: z.string().max(2000),
      instructions: z.string().max(10000),
      scheduledStartAt: z.string().datetime(),
      scheduledEndAt: z.string().datetime(),
      expectedUpdatedAt: z.string().datetime(),
      reason: z.string().max(1000),
      operationKey: idSchema,
    })
    .refine((item) => new Date(item.scheduledEndAt) > new Date(item.scheduledStartAt), {
      path: ["scheduledEndAt"],
      message: "Closing time must be after opening time.",
    })
    .safeParse({
      examId: value(formData, "examId"),
      title: value(formData, "title"),
      description: value(formData, "description"),
      instructions: value(formData, "instructions"),
      scheduledStartAt: scheduleValue(formData, "scheduledStartAt"),
      scheduledEndAt: scheduleValue(formData, "scheduledEndAt"),
      expectedUpdatedAt: value(formData, "expectedUpdatedAt"),
      reason: value(formData, "reason"),
      operationKey: operationKey(formData),
    });
  if (!parsed.success) redirect(adminErrorPath(value(formData, "examId"), "invalid_details"));
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_exam_metadata", {
    target_exam: parsed.data.examId,
    new_title: parsed.data.title,
    new_description: parsed.data.description,
    new_instructions: parsed.data.instructions,
    new_start: parsed.data.scheduledStartAt,
    new_end: parsed.data.scheduledEndAt,
    expected_updated_at: parsed.data.expectedUpdatedAt,
    change_reason: parsed.data.reason,
    operation_key: parsed.data.operationKey,
  });
  if (error) {
    console.error("Exam metadata update failed", { code: error.code });
    redirect(adminErrorPath(parsed.data.examId, "update_failed"));
  }
  revalidatePath("/teacher");
  revalidatePath(`/teacher/exams/${parsed.data.examId}`);
  redirect(`/teacher/exams/${parsed.data.examId}?notice=details_updated`);
}

export async function rescheduleExam(formData: FormData) {
  await requireRole("teacher");
  const examId = idSchema.parse(value(formData, "examId"));
  const start = scheduleValue(formData, "scheduledStartAt");
  const end = scheduleValue(formData, "scheduledEndAt");
  const expected = z.string().datetime().safeParse(value(formData, "expectedUpdatedAt"));
  const reason = value(formData, "reason");
  if (!start || !end || new Date(end) <= new Date(start) || !expected.success || reason.length < 3) {
    redirect(adminErrorPath(examId, "invalid_reschedule"));
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("reschedule_exam", {
    target_exam: examId,
    new_start: start,
    new_end: end,
    reopen: value(formData, "reopen") === "true",
    expected_updated_at: expected.data,
    change_reason: reason,
    operation_key: operationKey(formData),
  });
  if (error) {
    console.error("Exam reschedule failed", { code: error.code });
    redirect(adminErrorPath(examId, "reschedule_failed"));
  }
  revalidatePath("/teacher");
  revalidatePath(`/teacher/exams/${examId}`);
  redirect(`/teacher/exams/${examId}?notice=rescheduled`);
}

export async function publishExamAdmin(formData: FormData) {
  await requireRole("teacher");
  const examId = idSchema.parse(value(formData, "examId"));
  const supabase = await createClient();
  const { error } = await supabase.rpc("publish_exam", {
    target_exam: examId,
    operation_key: operationKey(formData),
  });
  if (error) {
    console.error("Exam publish failed", { code: error.code });
    redirect(adminErrorPath(examId, "publish_validation_failed"));
  }
  revalidatePath("/teacher");
  revalidatePath(`/teacher/exams/${examId}`);
  redirect(`/teacher/exams/${examId}?notice=published`);
}

export async function archiveExam(formData: FormData) {
  await requireRole("teacher");
  const examId = idSchema.parse(value(formData, "examId"));
  const supabase = await createClient();
  const { error } = await supabase.rpc("archive_exam", {
    target_exam: examId,
    change_reason: value(formData, "reason"),
    operation_key: operationKey(formData),
  });
  if (error) {
    console.error("Exam archive failed", { code: error.code });
    redirect(adminErrorPath(examId, "archive_failed"));
  }
  revalidatePath("/teacher");
  revalidatePath(`/teacher/exams/${examId}`);
  redirect("/teacher?status=archived&notice=archived");
}

export async function closeExam(formData: FormData) {
  await requireRole("teacher");
  const examId = idSchema.parse(value(formData, "examId"));
  const supabase = await createClient();
  const { error } = await supabase.rpc("close_exam", {
    target_exam: examId,
    change_reason: value(formData, "reason"),
    operation_key: operationKey(formData),
  });
  if (error) redirect(adminErrorPath(examId, "close_failed"));
  revalidatePath("/teacher");
  revalidatePath(`/teacher/exams/${examId}`);
  redirect(`/teacher/exams/${examId}?notice=closed`);
}

export async function restoreExam(formData: FormData) {
  await requireRole("teacher");
  const examId = idSchema.parse(value(formData, "examId"));
  const supabase = await createClient();
  const { error } = await supabase.rpc("restore_exam", {
    target_exam: examId,
    change_reason: value(formData, "reason"),
    operation_key: operationKey(formData),
  });
  if (error) redirect(adminErrorPath(examId, "restore_failed"));
  revalidatePath("/teacher");
  redirect(`/teacher/exams/${examId}?notice=restored`);
}

export async function deleteExam(formData: FormData) {
  await requireRole("teacher");
  const examId = idSchema.parse(value(formData, "examId"));
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("delete_exam", {
    target_exam: examId,
    confirmation_title: value(formData, "confirmationTitle"),
    change_reason: value(formData, "reason"),
    operation_key: operationKey(formData),
  });
  if (error) {
    console.error("Exam deletion failed", { code: error.code });
    redirect(adminErrorPath(examId, "delete_failed"));
  }
  const paths = (data ?? []) as string[];
  if (paths.length) {
    const cleanup = await supabase.storage.from("question-images").remove(paths);
    if (!cleanup.error) {
      await supabase.rpc("acknowledge_storage_cleanup", { cleaned_paths: paths });
    } else {
      console.error("Deferred exam image cleanup", { code: cleanup.error.name });
    }
  }
  revalidatePath("/teacher");
  redirect("/teacher?notice=deleted");
}

export async function duplicateExam(formData: FormData) {
  await requireRole("teacher");
  const sourceExamId = idSchema.parse(value(formData, "examId"));
  const targetExamId = idSchema.parse(value(formData, "targetExamId"));
  const key = operationKey(formData);
  const newTitle = value(formData, "newTitle");
  const supabase = await createClient();
  const { error: beginError } = await supabase.rpc("begin_exam_duplication", {
    source_exam: sourceExamId,
    target_exam: targetExamId,
    operation_key: key,
  });
  if (beginError) redirect(adminErrorPath(sourceExamId, "duplicate_failed"));

  const { data: questions, error: questionError } = await supabase
    .from("questions")
    .select("image_path,exam_sections!inner(exam_id)")
    .eq("exam_sections.exam_id", sourceExamId);
  if (questionError) redirect(adminErrorPath(sourceExamId, "duplicate_failed"));

  const imageMap: Record<string, string> = {};
  const copiedPaths: string[] = [];
  for (const question of questions ?? []) {
    if (!question.image_path || imageMap[question.image_path]) continue;
    const extension = question.image_path.split(".").pop()?.toLowerCase();
    if (!extension || !["png", "jpg", "jpeg", "webp"].includes(extension)) {
      if (copiedPaths.length) await supabase.storage.from("question-images").remove(copiedPaths);
      redirect(adminErrorPath(sourceExamId, "duplicate_failed"));
    }
    const fileName = `${await stablePathToken(question.image_path)}.${extension}`;
    const targetFolder = `${targetExamId}/duplicates`;
    const targetPath = `${targetFolder}/${fileName}`;
    const copy = await supabase.storage.from("question-images").copy(question.image_path, targetPath);
    if (copy.error) {
      const { data: existing, error: listError } = await supabase.storage
        .from("question-images")
        .list(targetFolder, { search: fileName, limit: 2 });
      if (listError || !existing?.some((object) => object.name === fileName)) {
        if (copiedPaths.length) await supabase.storage.from("question-images").remove(copiedPaths);
        redirect(adminErrorPath(sourceExamId, "duplicate_failed"));
      }
    } else {
      copiedPaths.push(targetPath);
    }
    imageMap[question.image_path] = targetPath;
  }

  const completion = await supabase.rpc("complete_exam_duplication", {
    target_exam: targetExamId,
    new_title: newTitle,
    image_map: imageMap,
    operation_key: key,
  });
  if (completion.error) {
    const { data: existing } = await supabase.from("exams").select("id").eq("id", targetExamId).maybeSingle();
    if (!existing && copiedPaths.length) {
      await supabase.storage.from("question-images").remove(copiedPaths);
    }
    if (!existing) redirect(adminErrorPath(sourceExamId, "duplicate_failed"));
  }
  revalidatePath("/teacher");
  redirect(`/teacher/exams/${targetExamId}?notice=duplicated`);
}

export async function replaceQuestionImage(formData: FormData) {
  await requireRole("teacher");
  const examId = idSchema.parse(value(formData, "examId"));
  const questionId = idSchema.parse(value(formData, "questionId"));
  const image = formData.get("image");
  if (!(image instanceof File) || !image.size) redirect(adminErrorPath(examId, "image_required"));
  const extensions: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
  };
  const extension = extensions[image.type];
  if (!extension || image.size > 8 * 1024 * 1024) redirect(adminErrorPath(examId, "invalid_image"));
  const key = operationKey(formData);
  const newPath = `${examId}/replacements/${key}.${extension}`;
  const supabase = await createClient();
  const upload = await supabase.storage.from("question-images").upload(newPath, image, {
    contentType: image.type,
    upsert: true,
  });
  if (upload.error) redirect(adminErrorPath(examId, "image_upload_failed"));
  const replacement = await supabase.rpc("replace_question_image", {
    target_question: questionId,
    expected_old_path: value(formData, "expectedOldPath") || null,
    new_path: newPath,
    change_reason: value(formData, "reason"),
    operation_key: key,
  });
  if (replacement.error) {
    const { data: current } = await supabase.from("questions").select("image_path").eq("id", questionId).maybeSingle();
    if (current?.image_path !== newPath) await supabase.storage.from("question-images").remove([newPath]);
    redirect(adminErrorPath(examId, "image_replace_failed"));
  }
  const oldPath = replacement.data as string | null;
  if (oldPath) {
    const cleanup = await supabase.storage.from("question-images").remove([oldPath]);
    if (!cleanup.error) await supabase.rpc("acknowledge_storage_cleanup", { cleaned_paths: [oldPath] });
  }
  revalidatePath(`/teacher/exams/${examId}`);
  redirect(`/teacher/exams/${examId}?notice=image_replaced`);
}

async function attemptOperation(
  formData: FormData,
  rpc: "reset_attempt" | "authorize_attempt_retake" | "teacher_submit_attempt" | "teacher_submit_section",
) {
  await requireRole("teacher");
  const attemptId = idSchema.parse(value(formData, "attemptId"));
  const examId = idSchema.parse(value(formData, "examId"));
  const args = {
    change_reason: value(formData, "reason"),
    operation_key: operationKey(formData),
    ...(rpc === "teacher_submit_section"
      ? { target_section_attempt: idSchema.parse(value(formData, "sectionAttemptId")) }
      : { target_attempt: attemptId }),
  };
  const supabase = await createClient();
  const { error } = await supabase.rpc(rpc, args);
  if (error) {
    console.error("Attempt administration failed", { rpc, code: error.code });
    redirect(`/teacher/attempts/${attemptId}?error=operation_failed`);
  }
  revalidatePath(`/teacher/attempts/${attemptId}`);
  revalidatePath(`/teacher/exams/${examId}/monitor`);
  revalidatePath(`/teacher/exams/${examId}/results`);
  redirect(`/teacher/attempts/${attemptId}?notice=operation_completed`);
}

export async function resetAttempt(formData: FormData) {
  return attemptOperation(formData, "reset_attempt");
}

export async function authorizeRetake(formData: FormData) {
  return attemptOperation(formData, "authorize_attempt_retake");
}

export async function teacherSubmitAttempt(formData: FormData) {
  return attemptOperation(formData, "teacher_submit_attempt");
}

export async function teacherSubmitSection(formData: FormData) {
  return attemptOperation(formData, "teacher_submit_section");
}

export async function correctAnswerKey(formData: FormData) {
  await requireRole("teacher");
  const attemptId = idSchema.parse(value(formData, "attemptId"));
  const examId = idSchema.parse(value(formData, "examId"));
  const questionId = idSchema.parse(value(formData, "questionId"));
  const corrected = optionSchema.safeParse(value(formData, "correctedOption"));
  const reason = value(formData, "reason");
  if (!corrected.success || reason.length < 3) {
    redirect(`/teacher/attempts/${attemptId}?error=invalid_correction`);
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("correct_answer_key", {
    target_question: questionId,
    corrected: corrected.data,
    change_reason: reason,
    operation_key: operationKey(formData),
  });
  if (error) {
    console.error("Answer-key correction failed", { code: error.code });
    redirect(`/teacher/attempts/${attemptId}?error=correction_failed`);
  }
  revalidatePath(`/teacher/attempts/${attemptId}`);
  revalidatePath(`/teacher/exams/${examId}/results`);
  redirect(`/teacher/attempts/${attemptId}?notice=regraded`);
}
