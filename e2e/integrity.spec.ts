import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
test.describe("integrity enabled local workflows", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(
    process.env.E2E_INTEGRITY !== "true",
    "Requires the isolated integrity-enabled server",
  );
  let examId: string;
  let teacher: SupabaseClient;
  test.beforeAll(async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(url))
      throw new Error("Integrity tests require disposable local Supabase");
    teacher = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const login = await teacher.auth.signInWithPassword({
      email: "teacher@example.com",
      password: "LocalDemo123!",
    });
    if (login.error) throw login.error;
    examId = crypto.randomUUID();
    const key = crypto.randomUUID();
    for (const result of [
      await teacher.rpc("begin_exam_duplication", {
        source_exam: "30000000-0000-0000-0000-000000000001",
        target_exam: examId,
        operation_key: key,
      }),
      await teacher.rpc("complete_exam_duplication", {
        target_exam: examId,
        new_title: "Disposable integrity browser fixture",
        image_map: {},
        operation_key: key,
      }),
    ])
      if (result.error) throw result.error;
    const configured = await teacher.rpc("configure_exam_integrity", {
      target_exam: examId,
      settings: {
        enabled: true,
        restrict_clipboard: true,
        enforcement: true,
      },
    });
    if (configured.error) throw configured.error;
    const assigned = await teacher.rpc("set_exam_student_assignments", {
      target_exam: examId,
      target_students: [
        "20000000-0000-0000-0000-000000000001",
        "20000000-0000-0000-0000-000000000002",
      ],
    });
    if (assigned.error) throw assigned.error;
    const { data: modules } = await teacher
      .from("exam_sections")
      .select("id,duration_seconds")
      .eq("exam_id", examId)
      .eq("section_type", "module")
      .order("section_order");
    const calculator = await teacher.rpc("update_section_settings", {
      target_section: modules![0].id,
      new_duration_seconds: modules![0].duration_seconds,
      new_allow_calculator: true,
    });
    if (calculator.error) throw calculator.error;
    const { data: exam } = await teacher
      .from("exams")
      .select("updated_at")
      .eq("id", examId)
      .single();
    const schedule = await teacher.rpc("reschedule_exam", {
      target_exam: examId,
      new_start: new Date(Date.now() - 3600000).toISOString(),
      new_end: new Date(Date.now() + 3600000).toISOString(),
      reopen: false,
      expected_updated_at: exam!.updated_at,
      change_reason: "Disposable testing window",
      operation_key: crypto.randomUUID(),
    });
    if (schedule.error) throw schedule.error;
    const published = await teacher.rpc("publish_exam", {
      target_exam: examId,
      operation_key: crypto.randomUUID(),
    });
    if (published.error) throw published.error;
  });
  test.afterAll(async () => {
    if (!teacher || !examId) return;
    const { data: attempts } = await teacher
      .from("exam_attempts")
      .select("id,status")
      .eq("exam_id", examId);
    for (const a of attempts ?? [])
      if (a.status === "in_progress")
        await teacher.rpc("teacher_submit_attempt", {
          target_attempt: a.id,
          change_reason: "Finish disposable integrity test",
          operation_key: crypto.randomUUID(),
        });
    await teacher.rpc("close_exam", {
      target_exam: examId,
      change_reason: "Close disposable browser fixture",
      operation_key: crypto.randomUUID(),
    });
    const result = await teacher.rpc("delete_exam", {
      target_exam: examId,
      confirmation_title: "DELETE Disposable integrity browser fixture",
      change_reason: "Remove disposable integrity test records",
      operation_key: crypto.randomUUID(),
    });
    if (result.error) throw result.error;
  });
  test("warnings, offline isolation, calculator key fallback and answer saving", async ({
    page,
    context,
  }) => {
    await page.goto("/login");
    await page
      .getByLabel("Email address", { exact: true })
      .fill("student1@example.com");
    await page.getByLabel("Password", { exact: true }).fill("LocalDemo123!");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/student/);
    await page.goto(`/student/exams/${examId}`);
    await expect(
      page.getByRole("heading", { name: "Monitored assessment" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Start exam", exact: true }).click();
    await expect(page).toHaveURL(/\/student\/attempts\//);
    const moduleReady = page.waitForResponse(
      (response) =>
        response.url().includes("/api/integrity/") &&
        response.status() === 200 &&
        response
          .request()
          .postDataJSON()
          ?.observations?.some(
            (event: { type: string }) => event.type === "module_ready",
          ),
    );
    await page
      .getByRole("button", { name: "Begin module", exact: true })
      .click();
    await expect(page).toHaveURL(/\/sections\//);
    await moduleReady;
    await page.screenshot({
      path: "test-results/integrity-student-desktop.png",
      fullPage: true,
    });
    await expect(
      page.getByText("Integrity monitoring is enabled.", { exact: false }),
    ).toBeVisible();
    await page.evaluate(() =>
      document
        .querySelector("[data-integrity-surface]")!
        .dispatchEvent(new Event("copy", { bubbles: true, cancelable: true })),
    );
    await expect(page.getByText(/1 counted incident/)).toBeVisible();
    const sectionUrl = page.url();
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await page.waitForTimeout(5500);
    await expect(page.getByText(/1 counted incident/)).toBeVisible();
    await page.route("**/api/integrity/**", (route) =>
      route.fulfill({ status: 503, body: "Monitoring unavailable" }),
    );
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(
      page.getByText("Monitoring connection unavailable; retrying.", {
        exact: false,
      }),
    ).toBeVisible();
    await page.getByRole("radio").first().check();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await page.unroute("**/api/integrity/**");
    await page.getByRole("button", { name: "Calculator", exact: true }).click();
    await expect(
      page.getByText("The embedded calculator is not configured.", {
        exact: false,
      }),
    ).toBeVisible();
    const calculatorPanel = page.getByRole("region", {
      name: "Desmos calculator",
    });
    await calculatorPanel.press("2");
    await expect(page.getByRole("radio").first()).toBeChecked();
    await page.getByRole("button", { name: "Close calculator" }).click();
    await page.reload();
    await expect(page.getByText(/1 counted incident/)).toBeVisible();
    await expect(page.getByRole("radio").first()).toBeChecked();
    const second = await context.newPage();
    await second.goto(sectionUrl);
    await expect(
      second.getByText("Another exam session was recently active.", {
        exact: false,
      }),
    ).toBeVisible();
    await second.close();
    const result = await page.request.post("/api/integrity/sync", {
      headers: { Origin: new URL(page.url()).origin },
      data: {
        attemptId: crypto.randomUUID(),
        browserInstanceId: crypto.randomUUID(),
        documentId: crypto.randomUUID(),
        observations: [],
        count: 99,
      },
    });
    expect(result.status()).toBe(400);
    const cross = await page.request.post("/api/integrity/sync", {
      headers: { Origin: "https://untrusted.invalid" },
      data: {},
    });
    expect(cross.status()).toBe(403);
  });
  test("modules start without fullscreen and fullscreen events are not monitored", async ({
    page,
  }) => {
    await page.goto("/login");
    await page
      .getByLabel("Email address", { exact: true })
      .fill("student2@example.com");
    await page.getByLabel("Password", { exact: true }).fill("LocalDemo123!");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/student/);
    await page.goto(`/student/exams/${examId}`);
    await page.getByRole("button", { name: "Start exam", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Begin module", exact: true }),
    ).toBeVisible();
    await page.evaluate(() => {
      document.querySelector<HTMLElement>(
        "[data-integrity-surface]",
      )!.requestFullscreen = () => {
        throw new Error("The app must not request fullscreen");
      };
    });
    await page
      .getByRole("button", { name: "Begin module", exact: true })
      .click();
    await expect(page).toHaveURL(/\/sections\//);
    expect(await page.evaluate(() => Boolean(document.fullscreenElement))).toBe(
      false,
    );
    await page.evaluate(() => {
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    await page.waitForTimeout(2500);
    await expect(page.getByText(/counted incident/)).not.toBeVisible();
    await expect(page.getByRole("button", { name: /fullscreen/i })).toHaveCount(
      0,
    );
  });
  test("teacher can review immutable evidence and add a private note", async ({
    page,
  }) => {
    const { data: attempt } = await teacher
      .from("exam_attempts")
      .select("id")
      .eq("exam_id", examId)
      .eq("student_id", "20000000-0000-0000-0000-000000000001")
      .single();
    await page.goto("/login");
    await page
      .getByLabel("Email address", { exact: true })
      .fill("teacher@example.com");
    await page.getByLabel("Password", { exact: true }).fill("LocalDemo123!");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/teacher/);
    await page.goto(`/teacher/exams/${examId}/monitor`);
    const titleBox = await page
      .getByRole("heading", {
        name: "Disposable integrity browser fixture",
        exact: true,
      })
      .boundingBox();
    const integrityBox = await page
      .getByRole("heading", { name: "Integrity monitoring", exact: true })
      .boundingBox();
    expect(integrityBox!.y).toBeGreaterThan(titleBox!.y + titleBox!.height);
    await page.screenshot({
      path: "test-results/integrity-monitor-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(async () =>
        page
          .locator(".workspace-sidebar")
          .evaluate((element) => element.getBoundingClientRect().right),
      )
      .toBeLessThanOrEqual(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "test-results/integrity-monitor-mobile.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(`/teacher/attempts/${attempt!.id}`);
    await expect(
      page.getByRole("heading", { name: "Integrity timeline & review" }),
    ).toBeVisible();
    const observation = page
      .locator("article")
      .filter({
        has: page.locator("b").getByText("clipboard", { exact: true }),
      })
      .first();
    await observation
      .getByLabel("Review reason")
      .fill("Disposable false positive review");
    await observation
      .getByRole("button", { name: "Dismiss", exact: true })
      .click();
    await expect(
      page.getByText("Review action recorded.", { exact: false }),
    ).toBeVisible();
    await expect(
      observation.getByRole("button", { name: "Reinstate" }),
    ).toBeVisible();
    await page
      .getByLabel("Private teacher note")
      .fill("Private disposable review note");
    await page.getByRole("button", { name: "Add note" }).click();
    await page.getByText("Review history & private notes").click();
    await expect(
      page.getByText("Private disposable review note", { exact: false }),
    ).toBeVisible();
  });
  test("disabled monitoring preserves the ordinary student workflow", async ({
    page,
  }) => {
    const settings = await teacher.rpc("configure_exam_integrity", {
      target_exam: examId,
      settings: {
        enabled: false,
        require_fullscreen: true,
        restrict_clipboard: true,
        enforcement: true,
        threshold: 3,
        cooldown_seconds: 10,
      },
      change_reason: "Disposable disabled policy regression",
    });
    if (settings.error) throw settings.error;
    const assigned = await teacher.rpc("set_exam_student_assignments", {
      target_exam: examId,
      target_students: [
        "20000000-0000-0000-0000-000000000001",
        "20000000-0000-0000-0000-000000000002",
        "20000000-0000-0000-0000-000000000003",
      ],
    });
    if (assigned.error) throw assigned.error;
    await page.goto("/login");
    await page
      .getByLabel("Email address", { exact: true })
      .fill("student3@example.com");
    await page.getByLabel("Password", { exact: true }).fill("LocalDemo123!");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/student/);
    await page.goto(`/student/exams/${examId}`);
    await expect(
      page.getByRole("heading", { name: "Monitored assessment" }),
    ).not.toBeVisible();
    await page.getByRole("button", { name: "Start exam", exact: true }).click();
    await page
      .getByRole("button", { name: "Begin module", exact: true })
      .click();
    await expect(page).toHaveURL(/\/sections\//);
    await expect(
      page.getByText("Integrity monitoring is enabled.", { exact: false }),
    ).not.toBeVisible();
    expect(
      await page.evaluate(() =>
        document
          .querySelector("[data-integrity-surface]")!
          .dispatchEvent(
            new Event("copy", { bubbles: true, cancelable: true }),
          ),
      ),
    ).toBe(true);
    await page.getByRole("radio").first().check();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  });
  test("disabled monitoring stays visible and teacher settings save without a reason", async ({
    page,
  }) => {
    await page.goto("/login");
    await page
      .getByLabel("Email address", { exact: true })
      .fill("teacher@example.com");
    await page.getByLabel("Password", { exact: true }).fill("LocalDemo123!");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/teacher/);
    await page.goto(`/teacher/exams/${examId}/monitor`);
    const panel = page.getByRole("region", {
      name: "Integrity monitoring",
      exact: true,
    });
    await expect(panel).toBeVisible();
    await expect(panel.getByText("Off", { exact: true })).toBeVisible();
    await panel.getByRole("link", { name: "Configure monitoring" }).click();
    await expect(
      page.getByRole("heading", {
        name: "Exam integrity monitoring",
        exact: true,
      }),
    ).toBeVisible();
    const settings = page.getByRole("region", {
      name: "Exam integrity monitoring",
      exact: true,
    });
    await expect(settings.getByRole("spinbutton")).toHaveCount(0);
    await expect(settings.getByRole("textbox")).toHaveCount(0);
    await expect(settings.getByText(/fullscreen/i)).toHaveCount(0);
    await settings
      .getByRole("button", { name: "Save monitoring policy" })
      .click();
    await expect(
      settings.getByText("Monitoring settings saved.", { exact: false }),
    ).toBeVisible();
  });
  test("Super Admin can save integrity policy settings", async ({ page }) => {
    await page.goto("/login");
    await page
      .getByLabel("Email address", { exact: true })
      .fill("admin@example.com");
    await page.getByLabel("Password", { exact: true }).fill("AdminLocal123!");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/admin/);
    await page
      .getByRole("link", { name: "Integrity policy", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "System values" }),
    ).toBeVisible();
    await expect(page.getByRole("spinbutton")).toHaveCount(8);
    await page.getByRole("button", { name: "Save integrity policy" }).click();
    await expect(page.getByText("Integrity policy saved.", { exact: true })).toBeVisible();
    await page.getByRole("tab", { name: "Monitoring & review" }).click();
    await expect(
      page.getByRole("heading", { name: "What is monitored" }),
    ).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "test-results/integrity-admin-policy-mobile.png",
      fullPage: true,
    });
  });
});
