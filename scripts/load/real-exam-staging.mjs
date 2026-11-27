import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { randomUUID } from "node:crypto";
import { chromium } from "@playwright/test";

// Disposable staging-only scenario. Never point this at production.
const stagingRef = "ranrlqfsihteuwxhisek";
const supabaseUrl = `https://${stagingRef}.supabase.co`;
const appUrl = "https://examination-platform-git-staging-zaab2.vercel.app";
const serviceKey = process.env.STAGING_SERVICE_ROLE_KEY;
const anonKey = process.env.STAGING_ANON_KEY;
const bypass = process.env.STAGING_VERCEL_BYPASS;
const useSectionAction = process.env.LOAD_USE_SECTION_ACTION === "1";
const browserCount = Number(process.env.LOAD_BROWSER_STUDENTS ?? 0);
const studentsCount = Number(process.argv[2] ?? 100);
const loginIntervalMs = Number(process.env.LOAD_LOGIN_INTERVAL_MS ?? 2700);
const answerIntervalMs = Number(process.env.LOAD_ANSWER_INTERVAL_MS ?? 8000);
const questionsCount = 10;
if (!serviceKey || !anonKey || !bypass) throw new Error("Staging credentials must be supplied in process environment.");
if (!Number.isInteger(studentsCount) || studentsCount < 1 || studentsCount > 100) throw new Error("Student count must be 1..100.");
if (!Number.isInteger(browserCount) || browserCount < 0 || browserCount > studentsCount || browserCount > 10) throw new Error("Browser student count must be 0..10.");
if (!Number.isInteger(loginIntervalMs) || loginIntervalMs < 0 || !Number.isInteger(answerIntervalMs) || answerIntervalMs < 0) throw new Error("Invalid intervals.");

const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const runId = randomUUID().slice(0, 8);
const password = `Load-${randomUUID()}!Aa1`;
const createdUsers = [];
const results = [];
let examId;
let browser;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const must = async request => {
  const { data, error } = await request;
  if (error) throw error;
  return data;
};
const measure = async (phase, task) => {
  const start = performance.now();
  try {
    const value = await task();
    if (value?.error) throw value.error;
    results.push({ phase, ms: Math.round(performance.now() - start), ok: true });
    return value;
  } catch (error) {
    const label = error?.name === "TimeoutError" || error?.code === 23
      ? "client_timeout_30s"
      : String(error?.code ?? error?.message ?? error).split("\n")[0];
    results.push({ phase, ms: Math.round(performance.now() - start), ok: false, error: label });
    throw error;
  }
};
const summary = phase => {
  const rows = results.filter(result => result.phase === phase);
  const times = rows.map(row => row.ms).sort((a, b) => a - b);
  const percentile = p => times[Math.min(times.length - 1, Math.ceil(times.length * p) - 1)] ?? null;
  console.log(JSON.stringify({ phase, requests: rows.length, failed: rows.filter(row => !row.ok).length,
    p50_ms: percentile(.5), p95_ms: percentile(.95), max_ms: times.at(-1) ?? null,
    errors: [...new Set(rows.filter(row => !row.ok).map(row => row.error))] }));
};
const createUser = async (role, index) => {
  const email = `load-${runId}-${role}${index}@example.invalid`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  createdUsers.push(data.user.id);
  return { id: data.user.id, email };
};
const login = async student => {
  const jar = new Map();
  const client = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: items => items.forEach(({ name, value }) => jar.set(name, value)),
    },
  });
  await measure("sign_in", () => client.auth.signInWithPassword({ email: student.email, password }));
  return { ...student, client, cookie: () => [...jar].map(([name, value]) => `${name}=${value}`).join("; ") };
};
const page = async (phase, student, path) => measure(phase, async () => {
  const response = await fetch(`${appUrl}${path}`, {
    headers: { "x-vercel-protection-bypass": bypass, cookie: student.cookie(), "user-agent": "Assessly-staging-load-test" },
    redirect: "manual", signal: AbortSignal.timeout(30000),
  });
  const body = await response.text();
  if (response.status !== 200) throw new Error(`HTTP ${response.status} ${response.headers.get("location") ?? ""}`);
  return body;
});
const startSectionAction = async (student, sectionId) => measure("start_section", async () => {
  if (!student.sectionActionId) throw new Error("Section form action was not found");
  const form = new FormData();
  form.set(`$ACTION_ID_${student.sectionActionId}`, "");
  form.set("attemptId", student.attemptId);
  form.set("sectionId", sectionId);
  const response = await fetch(`${appUrl}/student/attempts/${student.attemptId}`, {
    method: "POST", body: form, redirect: "manual", signal: AbortSignal.timeout(30000),
    headers: { "x-vercel-protection-bypass": bypass, cookie: student.cookie(),
      origin: appUrl, referer: `${appUrl}/student/attempts/${student.attemptId}`,
      "user-agent": "Assessly-staging-load-test" },
  });
  await response.arrayBuffer();
  const location = response.headers.get("location") ?? "";
  const match = location.match(/\/student\/attempts\/[0-9a-f-]+\/sections\/([0-9a-f-]+)/);
  if (response.status !== 303 || !match) throw new Error(`HTTP ${response.status} ${location}`);
  student.sectionAttemptId = match[1];
});
const wave = async (phase, students, task) => {
  await Promise.all(students.map(student => task(student).catch(() => undefined)));
  summary(phase);
};

console.log(JSON.stringify({ runId, students: studentsCount, browserStudents: browserCount, target: "staging", loginIntervalMs, answerIntervalMs }));
try {
  const teacher = await createUser("teacher", 0);
  await must(admin.from("profiles").upsert({ id: teacher.id, email: teacher.email, full_name: "Disposable Load Teacher", role: "teacher", is_active: true }));
  const students = [];
  for (let i = 0; i < studentsCount; i += 5) {
    students.push(...await Promise.all(Array.from({ length: Math.min(5, studentsCount - i) }, (_, j) => createUser("student", i + j))));
  }
  for (let i = 0; i < students.length; i += 20) {
    await must(admin.from("profiles").upsert(students.slice(i, i + 20).map((student, offset) => ({
      id: student.id, email: student.email, full_name: `Disposable Student ${i + offset}`, role: "student",
      is_active: true, approval_status: "approved", teacher_id: teacher.id,
    }))));
  }
  const now = Date.now();
  examId = (await must(admin.from("exams").insert({ title: `Disposable Exam ${runId}`, created_by: teacher.id,
    status: "published", scheduled_start_at: new Date(now - 60000).toISOString(),
    scheduled_end_at: new Date(now + 3600000).toISOString(), }).select("id").single())).id;
  const sectionId = (await must(admin.from("exam_sections").insert({ exam_id: examId, title: "Question module",
    section_type: "module", section_order: 1, duration_seconds: 1800 }).select("id").single())).id;
  const questions = await must(admin.from("questions").insert(Array.from({ length: questionsCount }, (_, index) => ({
    section_id: sectionId, question_order: index + 1, optional_text: `Disposable question ${index + 1}`,
    option_a: "A", option_b: "B", option_c: "C", option_d: "D",
  }))).select("id"));
  await must(admin.from("question_keys").insert(questions.map(question => ({ question_id: question.id, correct_option: "A" }))));
  for (let i = 0; i < students.length; i += 20) {
    await must(admin.from("exam_student_assignments").insert(students.slice(i, i + 20).map(student => ({
      exam_id: examId, student_id: student.id, assigned_by: teacher.id,
    }))));
  }

  console.log(JSON.stringify({ phase: "setup", users: createdUsers.length, questions: questions.length }));
  const loggedIn = [];
  for (const student of students) {
    try { loggedIn.push(await login(student)); } catch { /* Recorded above. */ }
    if (loginIntervalMs) await pause(loginIntervalMs);
  }
  summary("sign_in");
  if (browserCount) {
    browser = await chromium.launch({ channel: "msedge", headless: true });
    for (const student of loggedIn.slice(0, browserCount)) {
      const context = await browser.newContext();
      await context.addCookies(student.cookie().split("; ").map(part => {
        const split = part.indexOf("=");
        return { name: part.slice(0, split), value: part.slice(split + 1), url: appUrl };
      }));
      const browserPage = await context.newPage();
      await browserPage.route(`${appUrl}/**`, route => route.continue({ headers: {
        ...route.request().headers(), "x-vercel-protection-bypass": bypass,
      } }));
      student.browserPage = browserPage;
    }
  }
  console.log(JSON.stringify({ phase: "exam_live", students: loggedIn.length, useSectionAction }));
  await wave("student_home_page", loggedIn, student => student.browserPage
    ? measure("student_home_page", async () => {
      await student.browserPage.goto(`${appUrl}/student`, { waitUntil: "domcontentloaded", timeout: 30000 });
      if (student.browserPage.url().includes("/login")) throw new Error("Browser session redirected to login");
    })
    : page("student_home_page", student, "/student"));
  await wave("start_exam", loggedIn, async student => {
    const response = await measure("start_exam", () => student.client.rpc("start_exam", { target_exam: examId }));
    student.attemptId = response.data.id;
  });
  const active = loggedIn.filter(student => student.attemptId);
  await wave("attempt_progress_page", active, async student => {
    if (student.browserPage) {
      return measure("attempt_progress_page", async () => {
        await student.browserPage.goto(`${appUrl}/student/attempts/${student.attemptId}`, { waitUntil: "domcontentloaded", timeout: 30000 });
        await student.browserPage.getByRole("button", { name: "Begin module" }).waitFor({ timeout: 30000 });
      });
    }
    const html = await page("attempt_progress_page", student, `/student/attempts/${student.attemptId}`);
    student.sectionActionId = html.match(/name="\$ACTION_ID_([a-f0-9]+)"/)?.[1];
  });
  await wave("start_section", active, async student => {
    if (student.browserPage) return measure("start_section", async () => {
      await student.browserPage.getByRole("button", { name: "Begin module" }).click();
      await student.browserPage.waitForURL(/\/sections\/[0-9a-f-]+/, { timeout: 30000 });
      student.sectionAttemptId = student.browserPage.url().match(/\/sections\/([0-9a-f-]+)/)?.[1];
      if (!student.sectionAttemptId) throw new Error("Browser did not enter section");
    });
    if (useSectionAction) return startSectionAction(student, sectionId);
    const response = await measure("start_section", () => student.client.rpc("start_section", { target_attempt: student.attemptId, target_section: sectionId }));
    student.sectionAttemptId = response.data.id;
  });
  const running = active.filter(student => student.sectionAttemptId);
  await wave("section_page", running, student => student.browserPage
    ? measure("section_page", () => student.browserPage.getByText("Question 1 of 10").waitFor({ timeout: 30000 }))
    : page("section_page", student, `/student/attempts/${student.attemptId}/sections/${student.sectionAttemptId}`));
  for (let questionIndex = 0; questionIndex < questions.length; questionIndex++) {
    await wave(`answer_${questionIndex + 1}`, running, student => student.browserPage
      ? measure(`answer_${questionIndex + 1}`, async () => {
        await student.browserPage.locator('fieldset input[type="radio"][value="A"]').check();
        await student.browserPage.getByText("Saved", { exact: true }).waitFor({ timeout: 30000 });
        if (questionIndex < questions.length - 1) await student.browserPage.getByRole("button", { name: "Next" }).click();
      })
      : measure(`answer_${questionIndex + 1}`, () => student.client.rpc("save_answer", {
      target_section_attempt: student.sectionAttemptId, target_question: questions[questionIndex].id,
      new_option: "A", is_marked: false, revision: 1,
    })));
    if (questionIndex < questions.length - 1 && answerIntervalMs) await pause(answerIntervalMs);
  }
  await wave("submit_section", running, student => student.browserPage
    ? measure("submit_section", async () => {
      await student.browserPage.getByRole("button", { name: "Submit module" }).click();
      await student.browserPage.waitForURL(url => !url.pathname.includes("/sections/"), { timeout: 30000 });
    })
    : measure("submit_section", () => student.client.rpc("submit_section", {
      target_section_attempt: student.sectionAttemptId,
    })));
  console.log(JSON.stringify({ phase: "complete", students: running.length, failures: results.filter(row => !row.ok).length }));
  if (results.some(row => !row.ok) || running.length !== studentsCount) process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  // The content lock permits deletion only after the disposable attempts are gone.
  const attemptDelete = examId ? await admin.from("exam_attempts").delete().eq("exam_id", examId) : { error: null };
  const examDelete = examId && !attemptDelete.error ? await admin.from("exams").delete().eq("id", examId) : { error: null };
  let userDeleteErrors = 0;
  for (const id of createdUsers) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) userDeleteErrors++;
  }
  console.log(JSON.stringify({ phase: "cleanup", attemptDeleteError: attemptDelete.error?.message ?? null,
    examDeleteError: examDelete.error?.message ?? null,
    usersCreated: createdUsers.length, userDeleteErrors }));
  if (attemptDelete.error || examDelete.error || userDeleteErrors) process.exitCode = 1;
}
