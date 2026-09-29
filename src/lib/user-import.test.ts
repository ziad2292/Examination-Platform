import { describe, expect, it } from "vitest";
import { canRetryUserImport, parseUserImportFile, USER_IMPORT_LIMITS, userImportNeedsRollback, UserImportFileError, validateUserImportRows } from "./user-import";

const header = [["full_name", "email", "role", "password"]];
const goodPassword = "Summit!Pass123";

describe("bulk user import validation", () => {
  it("accepts students and teachers", () => {
    const rows = validateUserImportRows([...header, ["Student One", "student@example.com", "student", goodPassword], ["Teacher One", "teacher@example.com", "teacher", goodPassword]]);
    expect(rows.every((row) => row.errors.length === 0)).toBe(true);
  });

  it("normalizes identity fields without silently changing password whitespace", () => {
    const rows = validateUserImportRows([...header, ["  Student One  ", "  STUDENT@example.com ", " STUDENT ", ` ${goodPassword} `]]);
    expect(rows[0]).toMatchObject({ fullName: "Student One", email: "student@example.com", role: "student", password: ` ${goodPassword} `, errors: [] });
  });

  it("marks every duplicate email in the file", () => {
    const rows = validateUserImportRows([...header, ["First User", "same@example.com", "student", goodPassword], ["Second User", "SAME@example.com", "teacher", goodPassword]]);
    expect(rows.every((row) => row.errors.includes("Duplicate email in this file."))).toBe(true);
  });

  it("reports existing Auth emails, invalid emails, roles, and passwords per row", () => {
    const rows = validateUserImportRows([...header,
      ["Existing User", "existing@example.com", "student", goodPassword],
      ["Bad User", "not-an-email", "admin", "weak"],
    ], new Set(["existing@example.com"]));
    expect(rows[0].errors).toContain("Email already exists in Supabase Auth.");
    expect(rows[1].errors).toEqual(expect.arrayContaining(["Enter a valid email address.", "Role must be student or teacher."]));
  });

  it("rejects malformed headers and oversized batches", () => {
    expect(() => validateUserImportRows([["name", "email"]])).toThrow(UserImportFileError);
    const many = Array.from({ length: USER_IMPORT_LIMITS.maxRows + 1 }, (_, index) => [`User ${index}`, `user${index}@example.com`, "student", goodPassword]);
    expect(() => validateUserImportRows([...header, ...many])).toThrow(`at most ${USER_IMPORT_LIMITS.maxRows}`);
  });

  it("allows a fully rolled-back batch to retry but blocks unsafe partial rollback", () => {
    expect(canRetryUserImport("rolled_back")).toBe(true);
    expect(canRetryUserImport("rollback_failed")).toBe(false);
    expect(canRetryUserImport("completed")).toBe(false);
    expect(userImportNeedsRollback(["created", "failed"])).toBe(true);
    expect(userImportNeedsRollback(["created", "created"])).toBe(false);
  });

  it("rejects malformed CSV files", async () => {
    const file = new File(['full_name,email,role,password\n"Unclosed,email@example.com,student,Password!123'], "users.csv", { type: "text/csv" });
    await expect(parseUserImportFile(file)).rejects.toThrow("malformed or unreadable");
  });
});
