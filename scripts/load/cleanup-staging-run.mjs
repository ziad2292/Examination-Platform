import { createClient } from "@supabase/supabase-js";

const runId = process.argv[2];
const key = process.env.STAGING_SERVICE_ROLE_KEY;
if (!/^[0-9a-f]{8}$/.test(runId ?? "") || !key) throw new Error("Expected an eight-character staging run ID and staging service key.");
const admin = createClient("https://ranrlqfsihteuwxhisek.supabase.co", key, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const title = `Disposable Exam ${runId}`;
const { data: exams, error: lookupError } = await admin.from("exams").select("id,title").eq("title", title);
if (lookupError) throw lookupError;
if (exams.length > 1) throw new Error("More than one exam matched the disposable run; refusing cleanup.");
if (exams.length) {
  const { error: attemptError } = await admin.from("exam_attempts").delete().eq("exam_id", exams[0].id);
  if (attemptError) throw attemptError;
  const { error: examError } = await admin.from("exams").delete().eq("id", exams[0].id);
  if (examError) throw examError;
}
let deleted = 0;
for (let page = 1; page <= 10; page++) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
  if (error) throw error;
  const matches = data.users.filter(user => user.email?.startsWith(`load-${runId}-`) && user.email.endsWith("@example.invalid"));
  for (const user of matches) {
    const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
    if (deleteError) throw deleteError;
    deleted++;
  }
  if (data.users.length < 1000) break;
}
console.log(JSON.stringify({ runId, examDeleted: exams.length, usersDeleted: deleted }));
