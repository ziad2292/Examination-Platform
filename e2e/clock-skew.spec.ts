import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

test("an incorrect student clock cannot skip a module", async ({ page }) => {
  test.skip(process.env.E2E_REGISTRATION !== "true", "Requires disposable local Supabase data");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!/^http:\/\/(127\.0\.0\.1|localhost):54321$/.test(url)) throw new Error("Local Supabase required");
  const teacher = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signedIn = await teacher.auth.signInWithPassword({ email: "teacher@example.com", password: "LocalDemo123!" });
  if (signedIn.error) throw signedIn.error;
  const examId = crypto.randomUUID();
  const title = `QA clock skew ${examId.slice(0, 8)}`;
  const created = await teacher.rpc("create_exam_draft", {
    request_id: examId, exam_title: title, exam_description: null, exam_instructions: null,
    starts_at: new Date(Date.now() - 600_000).toISOString(),
    ends_at: new Date(Date.now() + 3_600_000).toISOString(),
    access_code: null, show_results: false,
  });
  if (created.error) throw created.error;
  try {
    const sections = await service.from("exam_sections").insert([
      { exam_id: examId, title: "Timed module", section_type: "module", section_order: 1, duration_seconds: 600 },
      { exam_id: examId, title: "Break", section_type: "break", section_order: 2, duration_seconds: 120 },
      { exam_id: examId, title: "Second module", section_type: "module", section_order: 3, duration_seconds: 600 },
    ]).select("id,section_order");
    if (sections.error) throw sections.error;
    const moduleId = sections.data.find((section) => section.section_order === 1)?.id;
    const secondModuleId = sections.data.find((section) => section.section_order === 3)?.id;
    if (!moduleId || !secondModuleId) throw new Error("Module fixture missing");
    const questionIds = [crypto.randomUUID(), crypto.randomUUID()];
    const questions = await service.from("questions").insert([moduleId,secondModuleId].map((sectionId,index)=>({ id: questionIds[index], section_id: sectionId, question_order: 1, optional_text: index===0 ? "Clock-safe question" : "Second question", option_a: "A", option_b: "B", option_c: "C", option_d: "D" })));
    if (questions.error) throw questions.error;
    const key = await service.from("question_keys").insert(questionIds.map((id)=>({ question_id: id, correct_option: "A" })));
    if (key.error) throw key.error;
    const assigned = await teacher.rpc("set_exam_student_assignments", { target_exam: examId, target_students: ["20000000-0000-0000-0000-000000000005"] });
    if (assigned.error) throw assigned.error;
    const published = await teacher.rpc("publish_exam", { target_exam: examId, operation_key: crypto.randomUUID() });
    if (published.error) throw published.error;

    await page.goto("/login");
    await page.getByLabel("Email address").fill("student5@example.com");
    await page.getByLabel("Password", { exact: true }).fill("LocalDemo123!");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/student$/);
    await page.goto(`/student/exams/${examId}`);
    await page.getByRole("button", { name: "Start exam", exact: true }).click();
    await page.getByRole("button", { name: "Begin module", exact: true }).click();
    await expect(page.getByText("Clock-safe question")).toBeVisible();
    await page.evaluate(() => {
      const NativeDate = Date;
      const ahead = 60 * 60 * 1000;
      class SkewedDate extends NativeDate {
        constructor(value?: string | number | Date) {
          super(value === undefined ? NativeDate.now() + ahead : value);
        }
        static now() { return NativeDate.now() + ahead; }
      }
      globalThis.Date = SkewedDate as DateConstructor;
    });
    await page.waitForTimeout(1500);
    await expect(page.getByText("Clock-safe question")).toBeVisible();
    await expect(page.getByRole("timer")).not.toHaveText("0:00");
    const attempts = await service.from("section_attempts").select("status").eq("section_id", moduleId).order("created_at", { ascending: false }).limit(1);
    expect(attempts.data?.[0]?.status).toBe("in_progress");
  } finally {
    const attempts = await teacher.from("exam_attempts").select("id,status").eq("exam_id", examId);
    for (const attempt of attempts.data ?? []) if (attempt.status === "in_progress") {
      await teacher.rpc("teacher_submit_attempt", { target_attempt: attempt.id, change_reason: "Finish disposable clock fixture", operation_key: crypto.randomUUID() });
    }
    const current = await teacher.from("exams").select("status").eq("id", examId).single();
    if (current.data?.status === "published") await teacher.rpc("close_exam", { target_exam: examId, change_reason: "Close disposable clock fixture", operation_key: crypto.randomUUID() });
    await teacher.rpc("delete_exam", { target_exam: examId, confirmation_title: `DELETE ${title}`, change_reason: "Remove disposable clock fixture", operation_key: crypto.randomUUID() });
  }
});
