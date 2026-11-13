import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  update: vi.fn(),
  rpc: vi.fn(),
  log: vi.spyOn(console, "error").mockImplementation(() => {}),
}));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireRole: async () => ({ id: "admin-id", role: "superadmin" }) }));
vi.mock("@/lib/supabase/admin", () => ({
  hasAdminConfig: () => true,
  createAdminClient: () => ({ auth: { admin: { updateUserById: state.update } } }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { email: "before@example.test", is_active: true }, error: null }) }) }) }),
  rpc: state.rpc,
}) }));
import { updateManagedUser } from "./user-administration";

beforeEach(() => { state.update.mockReset(); state.rpc.mockReset(); state.log.mockClear(); });
it("reports a failed rollback and correlates the account operation for recovery", async () => {
  state.update.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: { code: "auth_unavailable" } });
  state.rpc.mockResolvedValue({ error: { code: "profile_rejected" } });
  const form = new FormData();
  for (const [name, value] of Object.entries({
    userId: "20000000-0000-0000-0000-000000000001", fullName: "Student Name",
    email: "after@example.test", role: "student", active: "true",
    reason: "Correct account email", operationKey: "10000000-0000-0000-0000-000000000002",
  })) form.set(name, value);
  await expect(updateManagedUser(form)).rejects.toThrow("redirect:/admin?notice=auth_reconciliation_needed");
  expect(state.update).toHaveBeenCalledTimes(2);
  expect(state.update.mock.calls[1][1].email).toBe("before@example.test");
  expect(state.log).toHaveBeenCalledWith("Managed auth rollback failed", {
    code: "auth_unavailable", operationKey: "10000000-0000-0000-0000-000000000002",
  });
});
