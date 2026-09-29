import { describe, expect, it, vi } from "vitest";
import { cleanupDeletedExamImages, type ExamStorageCleanupClient } from "./exam-storage-cleanup";

describe("permanent exam Storage cleanup", () => {
  it("removes every queued image and acknowledges the cleanup", async () => {
    const remove = vi.fn().mockResolvedValue({ error: null });
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const client = { storage: { from: vi.fn(() => ({ remove })) }, rpc } as unknown as ExamStorageCleanupClient;
    const paths = ["exam/question-1.png", "exam/question-2.png"];
    await expect(cleanupDeletedExamImages(client, paths)).resolves.toEqual({ ok: true });
    expect(remove).toHaveBeenCalledWith(paths);
    expect(rpc).toHaveBeenCalledWith("acknowledge_storage_cleanup", { cleaned_paths: paths });
  });

  it("keeps the cleanup job pending when Storage removal fails", async () => {
    const rpc = vi.fn();
    const client = { storage: { from: () => ({ remove: vi.fn().mockResolvedValue({ error: { name: "StorageError" } }) }) }, rpc } as unknown as ExamStorageCleanupClient;
    await expect(cleanupDeletedExamImages(client, ["exam/question.png"])).resolves.toMatchObject({ ok: false, stage: "storage" });
    expect(rpc).not.toHaveBeenCalled();
  });
});
