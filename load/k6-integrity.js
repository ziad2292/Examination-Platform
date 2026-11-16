import http from "k6/http";
import crypto from "k6/crypto";
import encoding from "k6/encoding";
import execution from "k6/execution";
import { check, fail, sleep } from "k6";
export const options = {
  scenarios: {
    students: {
      executor: "per-vu-iterations",
      exec: "student",
      vus: 500,
      iterations: 1,
      maxDuration: "2m",
    },
    teachers: {
      executor: "per-vu-iterations",
      exec: "teacher",
      vus: 5,
      iterations: 1,
      maxDuration: "2m",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<1000"],
    checks: ["rate>0.99"],
  },
};
const base = __ENV.SUPABASE_URL;
const key = __ENV.SUPABASE_ANON_KEY;
const secret = __ENV.LOCAL_JWT_SECRET;
function token(id) {
  const header = encoding.b64encode(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
    "rawurl",
  );
  const payload = encoding.b64encode(
    JSON.stringify({
      sub: id,
      role: "authenticated",
      aud: "authenticated",
      iss: "supabase-demo",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
    "rawurl",
  );
  return `${header}.${payload}.${crypto.hmac("sha256", secret, `${header}.${payload}`, "base64rawurl")}`;
}
function headers(id) {
  if (!/^http:\/\/(localhost|127\.0\.0\.1):/.test(base) || !key || !secret)
    fail("Local Supabase URL, anon key, and local JWT signing secret required");
  return {
    apikey: key,
    Authorization: `Bearer ${token(id)}`,
    "Content-Type": "application/json",
  };
}
export function student() {
  // VU IDs are global across scenarios, so teacher VUs must not shift
  // student identities outside the fixture's exact 1..500 range.
  const studentIndex = execution.scenario.iterationInTest + 1;
  sleep((studentIndex % 500) / 50);
  const suffix = String(studentIndex).padStart(12, "0");
  const h = headers(`ac110001-0000-4000-8000-${suffix}`);
  let registered = false;
  for (let i = 0; i < 4; i++) {
    const response = http.post(
      `${base}/rest/v1/rpc/integrity_sync`,
      JSON.stringify({
        target_attempt: `ac110002-0000-4000-8000-${suffix}`,
        browser_instance: `ac110003-0000-4000-8000-${suffix}`,
        document_instance: `ac110004-0000-4000-8000-${suffix}`,
        observations: [],
        registration: !registered,
      }),
      { headers: h, tags: { operation: i === 0 ? "register" : "heartbeat" } },
    );
    check(response, { "heartbeat accepted": (r) => r.status === 200 });
    if (response.status === 200) registered = true;
    if (i < 3) sleep(20);
  }
}
export function teacher() {
  const h = headers("10000000-0000-0000-0000-000000000001");
  for (let i = 0; i < 5; i++) {
    const response = http.get(
      `${base}/rest/v1/attempt_integrity_state?exam_id=eq.ac110000-0000-4000-8000-000000000001&select=attempt_id,counted_incidents,review_required,revision,last_contact_at`,
      { headers: h, tags: { operation: "teacher_summary" } },
    );
    check(response, { "teacher summary authorized": (r) => r.status === 200 });
    if (i < 4) sleep(15);
  }
}
