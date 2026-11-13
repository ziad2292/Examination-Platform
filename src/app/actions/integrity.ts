"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { FormActionState } from "@/lib/form-state";
export async function configureIntegrity(
  _previous: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  await requireRole("teacher");
  const parsed = z
    .object({
      examId: z.guid(),
    })
    .safeParse({
      examId: form.get("examId"),
    });
  if (!parsed.success)
    return {
      ok: false,
      message: "The assessment could not be identified.",
    };
  const db = await createClient();
  const { error } = await db.rpc("configure_exam_integrity", {
    target_exam: parsed.data.examId,
    settings: {
      enabled: form.get("enabled") === "on",
      restrict_clipboard: form.get("clipboard") === "on",
      enforcement: form.get("enforcement") === "on",
    },
  });
  if (error)
    return { ok: false, message: "Monitoring settings could not be saved." };
  revalidatePath(`/teacher/exams/${parsed.data.examId}`);
  return {
    ok: true,
    message:
      "Monitoring settings saved. Existing attempts retain their policy snapshot.",
  };
}
export async function reviewIntegrity(
  _previous: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  await requireRole("teacher");
  const parsed = z
    .object({
      exam: z.guid(),
      attempt: z.guid().nullable(),
      student: z.guid().nullable(),
      event: z.guid().nullable(),
      action: z.enum(["dismiss", "reinstate", "note"]),
      reason: z.string().trim().min(3).max(1000),
    })
    .safeParse({
      exam: form.get("examId"),
      attempt: form.get("attemptId") || null,
      student: form.get("studentId") || null,
      event: form.get("eventId") || null,
      action: form.get("action"),
      reason: form.get("reason"),
    });
  if (!parsed.success)
    return {
      ok: false,
      message:
        "Choose an action and provide a reason of at least 3 characters.",
    };
  const db = await createClient();
  const p = parsed.data;
  const { error } = await db.rpc("review_exam_integrity", {
    target_exam: p.exam,
    target_attempt: p.attempt,
    target_student: p.student,
    target_event: p.event,
    review_action: p.action,
    change_reason: p.reason,
  });
  if (error)
    return {
      ok: false,
      message: error.message.includes("before starting")
        ? "Exceptions must be approved before the assigned student starts."
        : "Review could not be saved. Check your access and the selected attempt.",
    };
  revalidatePath(`/teacher/exams/${p.exam}/monitor`);
  if (p.attempt) revalidatePath(`/teacher/attempts/${p.attempt}`);
  return {
    ok: true,
    message: "Review action recorded. Original observations remain unchanged.",
  };
}
