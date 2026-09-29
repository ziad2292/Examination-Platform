"use server";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import {
  canRetryUserImport,
  parseUserImportFile,
  toUserImportPreview,
  UserImportFileError,
  type UserImportPreviewRow,
  type UserImportRow,
  userImportNeedsRollback,
  validateUserImportRows,
} from "@/lib/user-import";
import { createAdminClient, hasAdminConfig } from "@/lib/supabase/admin";

export type BulkUserImportState = {
  ok: boolean;
  phase: "idle" | "preview" | "complete" | "error";
  message: string;
  token?: string;
  rows: UserImportPreviewRow[];
  filename?: string;
};

const tokenPayloadSchema = z.object({
  version: z.literal(1),
  actorId: z.guid(),
  issuedAt: z.number().int(),
  operationKey: z.guid(),
  filename: z.string().min(1).max(255),
  fileSha256: z.string().regex(/^[a-f0-9]{64}$/),
  rows: z.array(z.object({
    rowNumber: z.number().int().min(2),
    fullName: z.string(),
    email: z.string(),
    role: z.enum(["student", "teacher"]),
    password: z.string(),
    errors: z.array(z.string()).length(0),
  })).min(1).max(50),
});

type TokenPayload = z.infer<typeof tokenPayloadSchema>;

function encryptionKey() {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("Admin configuration is missing");
  return createHash("sha256").update(`summit-user-import-v1:${secret}`).digest();
}

function seal(payload: TokenPayload) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), encrypted.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
}

function unseal(token: string) {
  const [version, ivValue, encryptedValue, tagValue] = token.split(".");
  if (version !== "v1" || !ivValue || !encryptedValue || !tagValue) throw new Error("Invalid import token");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(encryptedValue, "base64url")), decipher.final()]).toString("utf8");
  return tokenPayloadSchema.parse(JSON.parse(plaintext));
}

async function allAuthUsers(admin: ReturnType<typeof createAdminClient>) {
  const users: Array<{ id: string; email?: string; user_metadata?: Record<string, unknown> }> = [];
  const perPage = 1000;
  for (let page = 1; page <= 10000; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < perPage || (data.total && page * perPage >= data.total)) break;
  }
  return users;
}

async function existingAuthEmails(admin: ReturnType<typeof createAdminClient>) {
  const emails = new Set((await allAuthUsers(admin)).flatMap((user) => user.email ? [user.email.toLowerCase()] : []));
  const { data: profiles, error } = await admin.from("profiles").select("email");
  if (error) throw error;
  profiles?.forEach((profile) => emails.add(profile.email.toLowerCase()));
  return emails;
}

function errorState(message: string, rows: UserImportPreviewRow[] = []): BulkUserImportState {
  return { ok: false, phase: "error", message, rows };
}

export async function previewBulkUserImport(_previous: BulkUserImportState, formData: FormData): Promise<BulkUserImportState> {
  const viewer = await requireRole("superadmin");
  if (!hasAdminConfig()) return errorState("Bulk import is unavailable until the server administrator key is configured.");
  const file = formData.get("userFile");
  if (!(file instanceof File)) return errorState("Choose a CSV or XLSX file to preview.");
  try {
    const [rawRows, existingEmails, fileBytes] = await Promise.all([
      parseUserImportFile(file),
      existingAuthEmails(createAdminClient()),
      file.arrayBuffer(),
    ]);
    const rows = validateUserImportRows(rawRows, existingEmails);
    const preview = toUserImportPreview(rows);
    const invalid = preview.filter((row) => row.errors.length > 0).length;
    if (invalid) {
      return { ok: false, phase: "preview", message: `${invalid} row${invalid === 1 ? " needs" : "s need"} correction. Nothing has been imported.`, rows: preview, filename: file.name };
    }
    const payload: TokenPayload = {
      version: 1,
      actorId: viewer.id,
      issuedAt: Date.now(),
      operationKey: crypto.randomUUID(),
      filename: file.name.slice(0, 255),
      fileSha256: createHash("sha256").update(Buffer.from(fileBytes)).digest("hex"),
      rows: rows as TokenPayload["rows"],
    };
    return { ok: true, phase: "preview", message: `${rows.length} valid user${rows.length === 1 ? "" : "s"} ready to import.`, rows: preview, filename: file.name, token: seal(payload) };
  } catch (error) {
    const message = error instanceof UserImportFileError ? error.message : "The file could not be validated. No users were created.";
    if (!(error instanceof UserImportFileError)) console.error("Bulk user preview failed", { name: error instanceof Error ? error.name : "UnknownError" });
    return errorState(message);
  }
}

async function rollbackCreatedUsers(
  admin: ReturnType<typeof createAdminClient>,
  batchId: string,
  created: Array<{ row: UserImportRow; userId: string }>,
) {
  let rollbackFailed = false;
  const statuses = new Map<number, "rolled_back" | "rollback_failed">();
  for (const item of [...created].reverse()) {
    const deletion = await admin.auth.admin.deleteUser(item.userId);
    const status = deletion.error ? "rollback_failed" : "rolled_back";
    rollbackFailed ||= Boolean(deletion.error);
    statuses.set(item.row.rowNumber, status);
    await admin.from("user_import_items").update({
      status,
      error_code: deletion.error ? "rollback_failed" : "batch_rolled_back",
      error_message: deletion.error ? "Automatic rollback failed; an administrator must review this account." : "Removed because another row failed.",
    }).eq("batch_id", batchId).eq("row_number", item.row.rowNumber);
  }
  return { rollbackFailed, statuses };
}

async function recoverStaleImport(admin: ReturnType<typeof createAdminClient>, batchId: string) {
  const users = (await allAuthUsers(admin)).filter((user) => user.user_metadata?.import_batch_id === batchId);
  let rollbackFailed = false;
  for (const user of users) {
    const deletion = await admin.auth.admin.deleteUser(user.id);
    rollbackFailed ||= Boolean(deletion.error);
  }
  await admin.from("user_import_items").update({
    status: rollbackFailed ? "rollback_failed" : "rolled_back",
    error_code: rollbackFailed ? "stale_recovery_failed" : "stale_batch_recovered",
    error_message: rollbackFailed ? "Automatic recovery could not remove every account." : "Recovered after an interrupted import.",
  }).eq("batch_id", batchId).in("status", ["pending", "created"]);
  await admin.from("user_import_batches").update({ status: rollbackFailed ? "rollback_failed" : "rolled_back", created_count: 0, completed_at: new Date().toISOString() }).eq("id", batchId);
  return !rollbackFailed;
}

export async function executeBulkUserImport(_previous: BulkUserImportState, formData: FormData): Promise<BulkUserImportState> {
  const viewer = await requireRole("superadmin");
  if (!hasAdminConfig()) return errorState("Bulk import is unavailable until the server administrator key is configured.");
  const token = String(formData.get("importToken") ?? "");
  let payload: TokenPayload;
  try {
    payload = unseal(token);
  } catch {
    return errorState("This import preview is invalid. Upload the file again.");
  }
  if (payload.actorId !== viewer.id || Date.now() - payload.issuedAt > 30 * 60 * 1000) {
    return errorState("This import preview expired. Upload the file again so existing accounts can be checked afresh.");
  }

  const admin = createAdminClient();
  const { data: prior } = await admin.from("user_import_batches").select("id,status,created_count,created_at").eq("created_by", viewer.id).eq("operation_key", payload.operationKey).maybeSingle();
  if (prior?.status === "completed") {
    return { ok: true, phase: "complete", message: `${prior.created_count} users were already imported by this request.`, rows: toUserImportPreview(payload.rows), filename: payload.filename };
  }
  if (prior?.status === "rollback_failed") return errorState("This batch needs administrator review because automatic rollback did not finish safely.");
  if (prior?.status === "processing") {
    if (Date.now() - new Date(prior.created_at).getTime() < 10 * 60 * 1000) return errorState("This import is already processing. Wait before trying again.");
    if (!await recoverStaleImport(admin, prior.id)) return errorState("An interrupted import could not be recovered automatically. Administrator review is required.");
    prior.status = "rolled_back";
  }

  let rows: UserImportRow[];
  try {
    const rawRows = [["full_name", "email", "role", "password"], ...payload.rows.map((row) => [row.fullName, row.email, row.role, row.password])];
    rows = validateUserImportRows(rawRows, await existingAuthEmails(admin));
  } catch (error) {
    console.error("Bulk user import revalidation failed", { name: error instanceof Error ? error.name : "UnknownError" });
    return errorState("Existing accounts could not be checked. Nothing was imported.");
  }
  if (rows.some((row) => row.errors.length)) {
    return { ok: false, phase: "preview", message: "The account list changed after preview. Review the highlighted rows; nothing was imported.", rows: toUserImportPreview(rows), filename: payload.filename };
  }

  const batchId = prior?.id ?? crypto.randomUUID();
  if (prior && canRetryUserImport(prior.status)) {
    const retry = await admin.from("user_import_batches").update({ status: "processing", created_count: 0, failed_count: 0, completed_at: null }).eq("id", batchId).eq("status", "rolled_back").select("id").maybeSingle();
    if (retry.error || !retry.data) return errorState("This import is already being retried in another request.");
    const itemReset = await admin.from("user_import_items").update({ status: "pending", user_id: null, error_code: null, error_message: null }).eq("batch_id", batchId);
    if (itemReset.error) {
      await admin.from("user_import_batches").update({ status: "rolled_back" }).eq("id", batchId).eq("status", "processing");
      return errorState("The failed batch could not be prepared for retry.");
    }
  } else {
    const batch = await admin.from("user_import_batches").insert({
      id: batchId,
      created_by: viewer.id,
      operation_key: payload.operationKey,
      filename: payload.filename,
      file_sha256: payload.fileSha256,
      status: "processing",
      row_count: rows.length,
    });
    if (batch.error) {
      console.error("Bulk user batch creation failed", { code: batch.error.code });
      return errorState("The import could not start. No users were created.");
    }
    const items = await admin.from("user_import_items").insert(rows.map((row) => ({
      batch_id: batchId,
      row_number: row.rowNumber,
      full_name: row.fullName,
      email: row.email,
      role: row.role,
      status: "pending",
    })));
    if (items.error) {
      await admin.from("user_import_batches").delete().eq("id", batchId);
      return errorState("The import journal could not be created. No users were created.");
    }
  }

  const created: Array<{ row: UserImportRow; userId: string }> = [];
  const results = toUserImportPreview(rows);
  for (const row of rows) {
    const creation = await admin.auth.admin.createUser({
      email: row.email,
      password: row.password,
      email_confirm: true,
      user_metadata: { full_name: row.fullName, role: row.role, import_batch_id: batchId, import_row: row.rowNumber },
    });
    const result = results.find((item) => item.rowNumber === row.rowNumber)!;
    if (creation.error || !creation.data.user) {
      result.status = "failed";
      result.errors.push(creation.error?.code === "email_exists" || creation.error?.code === "user_already_exists" ? "Email was created by another request after preview." : "Supabase Auth could not create this account.");
      await admin.from("user_import_items").update({ status: "failed", error_code: creation.error?.code ?? "auth_create_failed", error_message: result.errors.at(-1) }).eq("batch_id", batchId).eq("row_number", row.rowNumber);
      continue;
    }
    const userId = creation.data.user.id;
    const profile = await admin.from("profiles").insert({ id: userId, full_name: row.fullName, email: row.email, role: row.role });
    if (profile.error) {
      const cleanup = await admin.auth.admin.deleteUser(userId);
      result.status = cleanup.error ? "rollback_failed" : "failed";
      result.errors.push(cleanup.error ? "Profile creation and automatic Auth cleanup both failed; administrator review is required." : "The profile could not be created; its Auth account was removed.");
      await admin.from("user_import_items").update({ status: result.status, user_id: cleanup.error ? userId : null, error_code: profile.error.code, error_message: result.errors.at(-1) }).eq("batch_id", batchId).eq("row_number", row.rowNumber);
      continue;
    }
    const journal = await admin.from("user_import_items").update({ status: "created", user_id: userId }).eq("batch_id", batchId).eq("row_number", row.rowNumber);
    if (journal.error) {
      await admin.auth.admin.deleteUser(userId);
      result.status = "failed";
      result.errors.push("The account journal could not be updated; the new account was removed.");
      continue;
    }
    result.status = "created";
    created.push({ row, userId });
  }

  const failed = results.filter((row) => row.status !== "created");
  if (userImportNeedsRollback(results.map((row) => row.status))) {
    const rollback = await rollbackCreatedUsers(admin, batchId, created);
    results.forEach((row) => { if (row.status === "created") row.status = rollback.statuses.get(row.rowNumber); });
    const rollbackFailed = rollback.rollbackFailed || results.some((row) => row.status === "rollback_failed");
    await admin.from("user_import_batches").update({ status: rollbackFailed ? "rollback_failed" : "rolled_back", created_count: 0, failed_count: failed.length, completed_at: new Date().toISOString() }).eq("id", batchId);
    await admin.from("admin_audit_events").insert({ actor_id: viewer.id, action: "user.bulk_import_failed", target_type: "user_import", target_id: batchId, reason: "Bulk user import failed and automatic rollback was attempted", after_state: { rows: rows.length, failures: failed.length, rollbackFailed }, idempotency_key: crypto.randomUUID() });
    return { ok: false, phase: "error", message: rollbackFailed ? "Import failed and automatic rollback needs administrator review. No retry is allowed for this batch." : "Import failed. Every newly created account was rolled back safely; correct the failed rows and upload again.", rows: results, filename: payload.filename };
  }

  const audit = await admin.from("admin_audit_events").insert({
    actor_id: viewer.id,
    action: "user.bulk_import_completed",
    target_type: "user_import",
    target_id: batchId,
    reason: "Created users through validated bulk import",
    after_state: { filename: payload.filename, fileSha256: payload.fileSha256, created: created.length },
    idempotency_key: payload.operationKey,
  });
  if (audit.error) {
    const rollback = await rollbackCreatedUsers(admin, batchId, created);
    const rollbackFailed = rollback.rollbackFailed;
    await admin.from("user_import_batches").update({ status: rollbackFailed ? "rollback_failed" : "rolled_back", created_count: 0, failed_count: rows.length, completed_at: new Date().toISOString() }).eq("id", batchId);
    return { ok: false, phase: "error", message: rollbackFailed ? "Accounts were created but audit recording and full rollback failed. Administrator review is required." : "Audit recording failed, so every new account was rolled back safely.", rows: results.map((row) => ({ ...row, status: rollback.statuses.get(row.rowNumber) ?? row.status })), filename: payload.filename };
  }

  await admin.from("user_import_batches").update({ status: "completed", created_count: created.length, failed_count: 0, completed_at: new Date().toISOString() }).eq("id", batchId);
  revalidatePath("/admin");
  return { ok: true, phase: "complete", message: `${created.length} user${created.length === 1 ? "" : "s"} imported successfully. Passwords were handed directly to Supabase Auth for secure hashing and were not stored in the import journal.`, rows: results, filename: payload.filename };
}

export async function manageBulkUserImport(previous: BulkUserImportState, formData: FormData) {
  return formData.get("intent") === "import"
    ? executeBulkUserImport(previous, formData)
    : previewBulkUserImport(previous, formData);
}
