import { parse as parseCsv } from "csv-parse/sync";
import { readSheet } from "read-excel-file/node";
import { z } from "zod";

export const USER_IMPORT_LIMITS = {
  maxFileBytes: 1024 * 1024,
  maxRows: 50,
  maxCellCharacters: 1000,
} as const;

export const USER_IMPORT_HEADERS = ["full_name", "email", "role", "password"] as const;

const emailSchema = z.email().max(254);
const passwordSchema = z.string().min(12).max(128)
  .regex(/[a-z]/, "Password needs a lowercase letter.")
  .regex(/[A-Z]/, "Password needs an uppercase letter.")
  .regex(/[0-9]/, "Password needs a number.")
  .regex(/[^A-Za-z0-9]/, "Password needs a symbol.");

export type UserImportRole = "student" | "teacher";
export type UserImportRow = {
  rowNumber: number;
  fullName: string;
  email: string;
  role: UserImportRole | "";
  password: string;
  errors: string[];
};

export type UserImportPreviewRow = Omit<UserImportRow, "password"> & {
  passwordValid: boolean;
  status?: "created" | "failed" | "rolled_back" | "rollback_failed";
};

export class UserImportFileError extends Error {}

function cellString(value: unknown, field: string, trim = true) {
  if (value === null || value === undefined) return "";
  if (typeof value !== "string") {
    throw new UserImportFileError(`${field} values must be stored as text. This protects values such as passwords from spreadsheet number conversion.`);
  }
  if (value.length > USER_IMPORT_LIMITS.maxCellCharacters) {
    throw new UserImportFileError(`${field} contains a value that is too long.`);
  }
  return trim ? value.trim() : value;
}

function normalizeHeaders(row: unknown[]) {
  const headers = row.map((cell) => cellString(cell, "Header").toLowerCase());
  const expected = new Set<string>(USER_IMPORT_HEADERS);
  const duplicates = headers.filter((header, index) => headers.indexOf(header) !== index);
  const missing = USER_IMPORT_HEADERS.filter((header) => !headers.includes(header));
  const unknown = headers.filter((header) => !expected.has(header));
  if (headers.length !== USER_IMPORT_HEADERS.length || duplicates.length || missing.length || unknown.length) {
    const details = [
      missing.length ? `missing ${missing.join(", ")}` : "",
      unknown.length ? `unexpected ${unknown.join(", ")}` : "",
      duplicates.length ? `duplicate ${[...new Set(duplicates)].join(", ")}` : "",
    ].filter(Boolean).join("; ");
    throw new UserImportFileError(`The header row must contain exactly: ${USER_IMPORT_HEADERS.join(", ")}.${details ? ` (${details})` : ""}`);
  }
  return headers;
}

export function validateUserImportRows(rawRows: unknown[][], existingEmails = new Set<string>()) {
  if (!rawRows.length) throw new UserImportFileError("The file is empty.");
  const headers = normalizeHeaders(rawRows[0]);
  const populated = rawRows.slice(1).map((cells, index) => ({ cells, rowNumber: index + 2 }))
    .filter(({ cells }) => cells.some((cell) => cell !== null && cell !== undefined && String(cell).trim() !== ""));
  if (!populated.length) throw new UserImportFileError("The file does not contain any user rows.");
  if (populated.length > USER_IMPORT_LIMITS.maxRows) {
    throw new UserImportFileError(`A single import can contain at most ${USER_IMPORT_LIMITS.maxRows} users.`);
  }

  const rows = populated.map(({ cells, rowNumber }) => {
    if (cells.length > headers.length && cells.slice(headers.length).some((cell) => String(cell ?? "").trim())) {
      throw new UserImportFileError(`Row ${rowNumber} contains more columns than the header row.`);
    }
    const record = Object.fromEntries(headers.map((header, index) => [header, cellString(cells[index], `Row ${rowNumber}`, header !== "password")]));
    const fullName = record.full_name;
    const email = record.email.toLowerCase();
    const role = record.role.toLowerCase();
    const password = record.password;
    const errors: string[] = [];
    if (fullName.length < 2 || fullName.length > 120) errors.push("Full name must be 2–120 characters.");
    if (!emailSchema.safeParse(email).success) errors.push("Enter a valid email address.");
    if (role !== "student" && role !== "teacher") errors.push("Role must be student or teacher.");
    const passwordResult = passwordSchema.safeParse(password);
    if (!passwordResult.success) errors.push(...new Set(passwordResult.error.issues.map((issue) => issue.message)));
    if (existingEmails.has(email)) errors.push("Email already exists in Supabase Auth.");
    return { rowNumber, fullName, email, role: role === "student" || role === "teacher" ? role : "", password, errors } satisfies UserImportRow;
  });

  const emailCounts = new Map<string, number>();
  rows.forEach((row) => emailCounts.set(row.email, (emailCounts.get(row.email) ?? 0) + 1));
  rows.forEach((row) => {
    if (row.email && (emailCounts.get(row.email) ?? 0) > 1) row.errors.push("Duplicate email in this file.");
  });
  return rows;
}

export function toUserImportPreview(rows: UserImportRow[]): UserImportPreviewRow[] {
  return rows.map(({ password, ...row }) => ({ ...row, passwordValid: passwordSchema.safeParse(password).success }));
}

export async function parseUserImportFile(file: File) {
  if (!file.name || file.size === 0) throw new UserImportFileError("Choose a non-empty CSV or XLSX file.");
  if (file.size > USER_IMPORT_LIMITS.maxFileBytes) throw new UserImportFileError("The file is larger than the 1 MB limit.");
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension !== "csv" && extension !== "xlsx") throw new UserImportFileError("Use a .csv or .xlsx file.");
  const bytes = Buffer.from(await file.arrayBuffer());
  try {
    if (extension === "csv") {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      return parseCsv(text, {
        bom: true,
        columns: false,
        skip_empty_lines: true,
        relax_column_count: false,
        max_record_size: 8192,
      }) as string[][];
    }
    if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
      throw new UserImportFileError("The XLSX file signature is invalid.");
    }
    return await readSheet(bytes);
  } catch (error) {
    if (error instanceof UserImportFileError) throw error;
    throw new UserImportFileError(`The ${extension.toUpperCase()} file is malformed or unreadable.`);
  }
}

export function canRetryUserImport(status: string) {
  return status === "rolled_back";
}

export function userImportNeedsRollback(statuses: Array<UserImportPreviewRow["status"]>) {
  return statuses.some((status) => status !== "created");
}
