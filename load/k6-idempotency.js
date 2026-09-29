import http from "k6/http";
import { check, fail } from "k6";

export const options = {
  scenarios: {
    duplicate_start: {
      executor: "shared-iterations",
      vus: 25,
      iterations: 100,
      maxDuration: "30s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<750"],
    checks: ["rate>0.99"],
  },
};

export function setup() {
  const base = __ENV.SUPABASE_URL;
  const key = __ENV.SUPABASE_ANON_KEY;
  const examId = __ENV.EXAM_ID;
  const email = __ENV.STUDENT_EMAIL;
  const password = __ENV.STUDENT_PASSWORD;
  if (!base || !key || !examId || !email || !password) fail("Missing required QA environment");

  const response = http.post(
    `${base}/auth/v1/token?grant_type=password`,
    JSON.stringify({ email, password }),
    { headers: { apikey: key, "Content-Type": "application/json" } },
  );
  if (response.status !== 200) fail(`QA login failed with ${response.status}`);
  return { base, key, examId, token: response.json("access_token") };
}

export default function duplicateStart(data) {
  const response = http.post(
    `${data.base}/rest/v1/rpc/start_exam`,
    JSON.stringify({ target_exam: data.examId, target_code: null }),
    {
      headers: {
        apikey: data.key,
        Authorization: `Bearer ${data.token}`,
        "Content-Type": "application/json",
      },
      tags: { operation: "duplicate_start_exam" },
      timeout: "10s",
    },
  );
  check(response, { "duplicate start remains successful": (result) => result.status === 200 });
}
