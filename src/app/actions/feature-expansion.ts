"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function saveExamRandomization(form: FormData) {
  await requireRole("teacher");
  const exam = z.uuid().parse(form.get("examId"));
  const db = await createClient();
  const { error } = await db.rpc("set_exam_randomization", {
    exam,
    enabled: form.get("randomize") === "on",
  });
  redirect(
    `/teacher/exams/${exam}?panel=settings&${error ? "error=question_delivery_failed" : "notice=question_delivery_saved"}`,
  );
}
