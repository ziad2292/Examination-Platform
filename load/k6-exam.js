import http from "k6/http";
import { check, fail, group, sleep } from "k6";

export const options = {
  scenarios: {
    expected_class: {
      executor: "per-vu-iterations",
      exec: "expectedClass",
      vus: 70,
      iterations: 1,
      maxDuration: "2m",
    },
    burst: {
      executor: "per-vu-iterations",
      exec: "burstClass",
      vus: 100,
      iterations: 1,
      startTime: "2m15s",
      maxDuration: "2m",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<1000", "p(99)<2000"],
    checks: ["rate>0.99"],
  },
};

const base = __ENV.SUPABASE_URL;
const key = __ENV.SUPABASE_ANON_KEY;
const examId = __ENV.EXAM_ID;
const password = __ENV.STUDENT_PASSWORD;
const prefix = __ENV.STUDENT_EMAIL_PREFIX || "loadstudent";
const domain = __ENV.STUDENT_EMAIL_DOMAIN || "example.com";

function requireConfiguration() {
  if (!base || !key || !examId || !password) {
    fail("SUPABASE_URL, SUPABASE_ANON_KEY, EXAM_ID, and STUDENT_PASSWORD are required");
  }
}

function headers(token) {
  return {
    apikey: key,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

function rpc(name, body, requestHeaders, tags = {}) {
  return http.post(`${base}/rest/v1/rpc/${name}`, JSON.stringify(body), {
    headers: requestHeaders,
    tags: { operation: name, ...tags },
    timeout: "15s",
  });
}

function examLoadScenario(accountOffset) {
  requireConfiguration();
  const studentNumber = accountOffset + __VU;
  const email = `${prefix}${studentNumber}@${domain}`;
  const auth = http.post(
    `${base}/auth/v1/token?grant_type=password`,
    JSON.stringify({ email, password }),
    {
      headers: { apikey: key, "Content-Type": "application/json" },
      tags: { operation: "login" },
      timeout: "15s",
    },
  );
  if (!check(auth, { "login succeeds": (response) => response.status === 200 })) return;

  const requestHeaders = headers(auth.json("access_token"));
  group("start or resume", () => {
    const started = rpc("start_exam", { target_exam: examId, target_code: null }, requestHeaders);
    if (!check(started, { "attempt available": (response) => response.status === 200 })) return;
    const attempt = Array.isArray(started.json()) ? started.json()[0] : started.json();

    const sections = http.get(
      `${base}/rest/v1/exam_sections?exam_id=eq.${examId}&section_type=eq.module&order=section_order.asc&limit=1`,
      { headers: requestHeaders, tags: { operation: "read_sections" }, timeout: "15s" },
    );
    if (!check(sections, { "section list loads": (response) => response.status === 200 })) return;
    const section = sections.json()[0];
    const active = rpc(
      "start_section",
      { target_attempt: attempt.id, target_section: section.id },
      requestHeaders,
    );
    if (!check(active, { "section starts": (response) => response.status === 200 })) return;
    const sectionAttempt = Array.isArray(active.json()) ? active.json()[0] : active.json();

    const questions = http.get(
      `${base}/rest/v1/questions?section_id=eq.${section.id}&select=id&order=question_order.asc&limit=10`,
      { headers: requestHeaders, tags: { operation: "read_questions" }, timeout: "15s" },
    );
    if (!check(questions, { "questions load": (response) => response.status === 200 })) return;

    questions.json().forEach((question, index) => {
      sleep(0.1 + Math.random() * 0.25);
      const saved = rpc(
        "save_answer",
        {
          target_section_attempt: sectionAttempt.id,
          target_question: question.id,
          new_option: ["A", "B", "C", "D"][index % 4],
          is_marked: index % 5 === 0,
          revision: index + 1,
        },
        requestHeaders,
      );
      check(saved, { "answer saves": (response) => response.status === 200 });
    });

    const submitted = rpc(
      "submit_section",
      { target_section_attempt: sectionAttempt.id },
      requestHeaders,
    );
    check(submitted, { "section submits": (response) => response.status === 200 });
  });
}

export function expectedClass() {
  examLoadScenario(0);
}

export function burstClass() {
  examLoadScenario(100);
}
