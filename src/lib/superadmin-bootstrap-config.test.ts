import { describe, expect, it } from "vitest";
// The production bootstrap is plain ESM so Node can run it without a TypeScript runtime.
import { maskEmail, readSuperadminBootstrapConfig } from "../../scripts/lib/superadmin-bootstrap-config.mjs";

const validEnvironment = {
  BOOTSTRAP_SUPERADMIN_ENABLED: "true",
  NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-value",
  BOOTSTRAP_SUPERADMIN_FULL_NAME: "Production Administrator",
  BOOTSTRAP_SUPERADMIN_EMAIL: "ADMIN@example.com",
  BOOTSTRAP_SUPERADMIN_PASSWORD: "StrongPassword123!",
};

describe("production Super Admin bootstrap configuration", () => {
  it("normalizes a valid environment without exposing the password", () => {
    const config = readSuperadminBootstrapConfig(validEnvironment);
    expect(config).toMatchObject({ email: "admin@example.com", rotatePassword: false, allowPromotion: false });
    expect(maskEmail(config.email)).toBe("ad***@example.com");
  });

  it("preserves password whitespace exactly", () => {
    const config = readSuperadminBootstrapConfig({ ...validEnvironment, BOOTSTRAP_SUPERADMIN_PASSWORD: " StrongPassword123! " });
    expect(config.password).toBe(" StrongPassword123! ");
  });

  it("requires an explicit one-time enable switch", () => {
    expect(() => readSuperadminBootstrapConfig({ ...validEnvironment, BOOTSTRAP_SUPERADMIN_ENABLED: "false" })).toThrow("must be true");
  });

  it("rejects weak passwords and placeholder secrets", () => {
    expect(() => readSuperadminBootstrapConfig({ ...validEnvironment, BOOTSTRAP_SUPERADMIN_PASSWORD: "weak" })).toThrow("BOOTSTRAP_SUPERADMIN_PASSWORD");
    expect(() => readSuperadminBootstrapConfig({ ...validEnvironment, SUPABASE_SERVICE_ROLE_KEY: "replace-with-key" })).toThrow("placeholder");
  });

  it("rejects ambiguous safety flags", () => {
    expect(() => readSuperadminBootstrapConfig({ ...validEnvironment, BOOTSTRAP_SUPERADMIN_ALLOW_PROMOTION: "yes" })).toThrow("true or false");
  });
});
