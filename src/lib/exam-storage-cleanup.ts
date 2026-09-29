type CleanupError = { name?: string; message?: string } | null;

export type ExamStorageCleanupClient = {
  storage: {
    from: (bucket: string) => {
      remove: (paths: string[]) => Promise<{ error: CleanupError }>;
    };
  };
  rpc: (name: string, args: { cleaned_paths: string[] }) => PromiseLike<{ error: CleanupError }>;
};

export async function cleanupDeletedExamImages(client: ExamStorageCleanupClient, paths: string[]) {
  if (!paths.length) return { ok: true as const };
  const cleanup = await client.storage.from("question-images").remove(paths);
  if (cleanup.error) return { ok: false as const, stage: "storage" as const, errorName: cleanup.error.name };
  const acknowledgement = await client.rpc("acknowledge_storage_cleanup", { cleaned_paths: paths });
  if (acknowledgement.error) return { ok: false as const, stage: "acknowledgement" as const, errorName: acknowledgement.error.name };
  return { ok: true as const };
}
