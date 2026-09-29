import { describe, expect, it } from "vitest";
import { canAccessRole, roleHome } from "./auth-policy";

describe("role authorization", () => {
  it("routes each role to its dedicated area", () => {
    expect(roleHome("superadmin")).toBe("/admin");
    expect(roleHome("teacher")).toBe("/teacher");
    expect(roleHome("student")).toBe("/student");
  });

  it("allows only superadmins into the admin area", () => {
    expect(canAccessRole("superadmin", "superadmin")).toBe(true);
    expect(canAccessRole("teacher", "superadmin")).toBe(false);
    expect(canAccessRole("student", "superadmin")).toBe(false);
    expect(canAccessRole(null, "superadmin")).toBe(false);
  });
});
