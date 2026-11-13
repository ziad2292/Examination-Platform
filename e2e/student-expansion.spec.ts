import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

for (const blockedStorage of [false, true]) test(`randomized module resumes in the same order, grades by question ID, and returns home${blockedStorage ? ' with blocked storage' : ''}`, async ({ page }) => {
  test.skip(process.env.E2E_REGISTRATION !== "true", "Requires disposable local Supabase data");
  test.setTimeout(90_000);
  if (blockedStorage) await page.addInitScript(() => {
    const read = Storage.prototype.getItem;
    Storage.prototype.getItem = function(key: string) {
      if (key.startsWith('summit-pending-')) throw new DOMException('Storage blocked', 'SecurityError');
      return read.call(this, key);
    };
  });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!/^http:\/\/(127\.0\.0\.1|localhost):54321$/.test(url)) throw new Error("Local Supabase required");
  const teacher = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const auth = await teacher.auth.signInWithPassword({ email: "teacher@example.com", password: "LocalDemo123!" });
  if (auth.error) throw auth.error;
  const exam = crypto.randomUUID();
  const moduleId = crypto.randomUUID();
  const fixtures = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const title = `QA randomized assessment ${exam.slice(0, 8)}`;
  const student = "20000000-0000-0000-0000-000000000001";
  const created = await teacher.rpc("create_exam_draft", {
    request_id: exam, exam_title: title, exam_description: null, exam_instructions: null,
    starts_at: new Date(Date.now() - 600_000).toISOString(),
    ends_at: new Date(Date.now() + 3_600_000).toISOString(), access_code: null, show_results: false,
  });
  if (created.error) throw created.error;
  try {
    const section = await fixtures.from("exam_sections").insert({ id: moduleId, exam_id: exam, title: "QA module", section_type: "module", section_order: 1, duration_seconds: 600 });
    if (section.error) throw section.error;
    const questions = Array.from({ length: 3 }, (_, index) => ({
      id: crypto.randomUUID(), section_id: moduleId, question_order: index + 1,
      optional_text: `QA prompt ${index + 1}`, option_a: "Wrong A", option_b: "Correct B", option_c: "Wrong C", option_d: "Wrong D",
    }));
    const questionRows = await fixtures.from("questions").insert(questions);
    if (questionRows.error) throw questionRows.error;
    const keys = await fixtures.from("question_keys").insert(questions.map(question => ({ question_id: question.id, correct_option: "B" })));
    if (keys.error) throw keys.error;
    const assigned = await teacher.rpc("set_exam_student_assignments", { target_exam: exam, target_students: [student] });
    if (assigned.error) throw assigned.error;

    await page.goto("/login");
    await page.getByLabel("Email address").fill("teacher@example.com");
    await page.getByLabel("Password", { exact: true }).fill("LocalDemo123!");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/teacher$/);
    await page.goto(`/teacher/exams/${exam}?panel=settings`);
    await page.getByRole("checkbox", { name: /Randomize Question Order/ }).check();
    await page.getByRole("button", { name: "Save question delivery" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Exam updated successfully" })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: /Randomize Question Order/ })).toBeChecked();

    const published = await teacher.rpc("publish_exam", { target_exam: exam, operation_key: crypto.randomUUID() });
    if (published.error) throw published.error;
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.goto("/login");
    await page.getByLabel("Email address").fill("student1@example.com");
    await page.getByLabel("Password", { exact: true }).fill("LocalDemo123!");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/student$/);
    await page.goto(`/student/exams/${exam}`);
    await page.getByRole("button", { name: "Start exam", exact: true }).click();
    await page.getByRole("button", { name: "Begin module", exact: true }).click();
    await expect(page.getByRole("timer")).not.toHaveAttribute("aria-live", "polite");
    const prompt = page.getByText(/^QA prompt [123]$/);
    await expect(prompt).toBeVisible();
    const first = await prompt.innerText();
    await page.getByRole("radio", { name: /Correct B/ }).check();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await page.reload();
    await expect(prompt).toHaveText(first);
    await expect(page.getByRole("radio", { name: /Correct B/ })).toBeChecked();
    const seen = [first];
    for (let index = 1; index < 3; index++) {
      await page.getByRole("button", { name: "Next", exact: true }).click();
      await expect(prompt).not.toHaveText(seen[index - 1]);
      seen.push(await prompt.innerText());
      await page.getByRole("radio", { name: /Correct B/ }).check();
      await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    }
    expect(new Set(seen).size).toBe(3);
    await page.getByRole("button", { name: "Submit module", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Exam complete" })).toBeVisible();
    await page.reload();
    await page.getByRole("link", { name: "Back to Home" }).click();
    await expect(page).toHaveURL(/\/student$/);
    await page.goto("/student/profile?panel=history");
    await expect(page.getByRole("link", { name: title, exact: true })).toBeVisible();
    await page.goto("/student/profile?panel=grades");
    await expect(page.getByRole("link", { name: title, exact: true })).toHaveCount(0);
    const release = await teacher.rpc("update_exam_feature_settings", { target_exam: exam, show_results: true });
    if (release.error) throw release.error;
    await page.reload();
    await expect(page.getByRole("listitem").filter({ hasText: title })).toContainText("3 / 3");
    await page.screenshot({ path: "test-results/student-profile-released-grade.png", fullPage: true, animations: "disabled" });
  } finally {
    const { data: attempts } = await teacher.from("exam_attempts").select("id,status").eq("exam_id", exam);
    for (const attempt of attempts ?? []) {
      if (attempt.status === "in_progress") await teacher.rpc("teacher_submit_attempt", { target_attempt: attempt.id, change_reason: "Finish disposable browser fixture", operation_key: crypto.randomUUID() });
    }
    const current = await teacher.from("exams").select("status").eq("id", exam).single();
    if (current.data?.status === "published") await teacher.rpc("close_exam", { target_exam: exam, change_reason: "Close disposable browser fixture", operation_key: crypto.randomUUID() });
    const removed = await teacher.rpc("delete_exam", { target_exam: exam, confirmation_title: `DELETE ${title}`, change_reason: "Remove disposable browser fixture", operation_key: crypto.randomUUID() });
    if (removed.error) throw removed.error;
  }
});


test("student verifies email, awaits approval, and reaches the profile after assignment", async ({
  page,
  browser,
  request,
}) => {
  test.skip(
    process.env.E2E_REGISTRATION !== "true",
    "Requires local Supabase with email confirmation and Mailpit",
  );
  test.setTimeout(120_000);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!/^http:\/\/(127\.0\.0\.1|localhost):54321$/.test(url)) {
    throw new Error("Registration tests require local Supabase");
  }
  const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const email = `assessly-qa-${crypto.randomUUID()}@example.com`;
  const name = `QA Student ${email.slice(12, 20)}`;
  const password = "LocalRegistrationQA123!";
  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  try {
    await page.goto("/register");
    // Wait for client hydration through an observable interaction before filling
    // controlled inputs. WebKit can finish document load ahead of hydration.
    await page.getByRole("button", { name: "Show password", exact: true }).click();
    await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "text");
    await page.getByRole("button", { name: "Hide password", exact: true }).click();
    await page.getByLabel("Full name").fill(name);
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Submit registration" }).click();
    await expect(
      page.getByRole("heading", { name: "Awaiting Administrator Approval" }),
    ).toBeVisible();

    await admin.goto("/login");
    await admin.getByLabel("Email address").fill("admin@example.com");
    await admin.getByLabel("Password", { exact: true }).fill("AdminLocal123!");
    await admin.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(admin).toHaveURL(/\/admin$/);
    await admin.goto("/admin/approvals");
    const application = admin.getByRole("article").filter({ hasText: email });
    await expect(application.getByText(/Email unverified/)).toBeVisible();
    await expect(
      application.getByRole("button", { name: "Approve" }),
    ).toBeDisabled();

    let messageId: string | undefined;
    await expect
      .poll(async () => {
        const response = await request.get(
          "http://127.0.0.1:54324/api/v1/search",
          { params: { query: `to:${email}` } },
        );
        if (!response.ok()) return false;
        const inbox = await response.json();
        messageId = inbox.messages?.[0]?.ID;
        return Boolean(messageId);
      })
      .toBe(true);
    const message = await (
      await request.get(`http://127.0.0.1:54324/api/v1/message/${messageId}`)
    ).json();
    const link = String(message.HTML ?? "")
      .match(/href="([^"]+\/auth\/v1\/verify[^"]+)"/)?.[1]
      ?.replaceAll("&amp;", "&");
    expect(link).toBeTruthy();
    await page.goto(link!);

    await page.goto("/login");
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/registration-status/);
    await page.goto("/student/profile");
    await expect(page).toHaveURL(/registration-status/);

    await admin.reload();
    await expect(application.getByText(/Email verified/)).toBeVisible();
    await application.getByRole("button", { name: "Approve" }).click();
    await expect(admin.getByText("Registration decision saved.")).toBeVisible();

    await admin.goto("/admin/students");
    await admin.getByRole("textbox", { name: "Search students" }).fill(email);
    await admin
      .getByRole("checkbox", { name: `Select ${name}`, exact: true })
      .check();
    await admin
      .getByLabel("Teacher", { exact: true })
      .selectOption("10000000-0000-0000-0000-000000000001");
    await admin.getByRole("button", { name: "Apply assignment" }).click();
    await expect(admin.getByText("Teacher assignments updated.")).toBeVisible();

    await page.goto("/student/profile");
    await expect(
      page.getByRole("heading", { name: "My profile" }),
    ).toBeVisible();
    await expect(page.getByText(email, { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "My teachers", exact: true }).click();
    await expect(page.getByRole("listitem")).toHaveCount(1);
    await page.getByRole("link", { name: "Grades & performance" }).click();
    await expect(
      page.getByText("No grades have been released to you yet."),
    ).toBeVisible();
    for (const width of [1440, 1024, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        )
        .toBe(true);
    }
    await page.screenshot({
      path: "test-results/student-profile-mobile.png",
      fullPage: true,
      animations: "disabled",
    });
  } finally {
    await adminContext.close();
    const { data } = await service
      .from("profiles")
      .select("id")
      .eq("email", email)
      .maybeSingle();
    if (data) {
      const { error } = await service.auth.admin.deleteUser(data.id);
      if (error) throw error;
    }
  }
});
