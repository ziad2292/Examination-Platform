"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import {
  bulkQuestionImportSchema,
  hasSupportedImageSignature,
  isQuestionImageType,
  stagedCleanupSchema,
  stagingPrefix,
} from "@/lib/question-import";
import { createClient } from "@/lib/supabase/server";

type ImportResult =
  | { ok: true; count: number; alreadyCompleted: boolean }
  | { ok: false; message: string; retryable: boolean };

function pathsBelongToBatch(paths: string[], userId: string, batchId: string) {
  const prefix = stagingPrefix(userId, batchId);
  return paths.every(
    (path) =>
      path.startsWith(prefix) &&
      !path.slice(prefix.length).includes("/") &&
      /^[0-9a-f-]+\.(png|jpg|webp)$/.test(path.slice(prefix.length)),
  );
}

async function stagedImagesHaveValidSignatures(
  supabase: Awaited<ReturnType<typeof createClient>>,
  paths: string[],
) {
  const { data, error } = await supabase.storage
    .from("question-images")
    .createSignedUrls(paths, 60);
  if (error || !data || data.length !== paths.length) return false;

  for (let offset = 0; offset < data.length; offset += 5) {
    const checks = await Promise.all(
      data.slice(offset, offset + 5).map(async (entry) => {
        try {
          if (!entry.signedUrl) return false;
          const response = await fetch(entry.signedUrl, {
            cache: "no-store",
            headers: { Range: "bytes=0-15" },
          });
          const mimeType = response.headers.get("content-type")?.split(";")[0] ?? "";
          if (!response.ok || !isQuestionImageType(mimeType)) return false;
          const bytes = new Uint8Array(await response.arrayBuffer());
          return hasSupportedImageSignature(bytes.slice(0, 16), mimeType);
        } catch {
          return false;
        }
      }),
    );
    if (checks.some((valid) => !valid)) return false;
  }
  return true;
}

export async function commitBulkQuestionImport(input: unknown): Promise<ImportResult> {
  const viewer = await requireRole("teacher");
  const parsed = bulkQuestionImportSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Review the batch and try again.", retryable: false };
  }

  const { batchId, examId, sectionId, items } = parsed.data;
  const paths = items.map((item) => item.imagePath);
  if (!pathsBelongToBatch(paths, viewer.id, batchId)) {
    return { ok: false, message: "The staged image paths are invalid.", retryable: false };
  }

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("question_import_batches")
    .select("status,question_count")
    .eq("id", batchId)
    .maybeSingle();
  if (existing?.status === "completed") {
    return { ok: true, count: existing.question_count, alreadyCompleted: true };
  }

  const { data: exam } = await supabase
    .from("exams")
    .select("id,status")
    .eq("id", examId)
    .single();
  const { data: section } = await supabase
    .from("exam_sections")
    .select("id,section_type")
    .eq("id", sectionId)
    .eq("exam_id", examId)
    .single();
  const { count: attempts } = await supabase
    .from("exam_attempts")
    .select("id", { count: "exact", head: true })
    .eq("exam_id", examId);

  if (!exam || !section || section.section_type !== "module") {
    return { ok: false, message: "This module is not available.", retryable: false };
  }
  if (!["draft", "published"].includes(exam.status) || attempts) {
    return {
      ok: false,
      message: "This exam is locked and can no longer be edited.",
      retryable: false,
    };
  }

  if (!(await stagedImagesHaveValidSignatures(supabase, paths))) {
    await supabase.storage.from("question-images").remove(paths);
    return {
      ok: false,
      message: "One or more staged files are not valid PNG, JPEG, or WebP images.",
      retryable: false,
    };
  }

  const { data, error } = await supabase.rpc("bulk_create_questions", {
    target_exam: examId,
    target_section: sectionId,
    import_batch: batchId,
    import_items: items,
  });

  if (error) {
    const { data: completed, error: statusError } = await supabase
      .from("question_import_batches")
      .select("status,question_count")
      .eq("id", batchId)
      .maybeSingle();

    if (completed?.status === "completed") {
      revalidatePath(`/teacher/exams/${examId}`);
      return { ok: true, count: completed.question_count, alreadyCompleted: true };
    }

    const confirmedDatabaseRejection =
      !statusError &&
      (error.code.startsWith("22") || error.code.startsWith("23") || error.code === "P0001");
    if (confirmedDatabaseRejection) {
      await supabase.storage.from("question-images").remove(paths);
    }

    console.error("Bulk question import failed", { code: error.code });
    return {
      ok: false,
      message: confirmedDatabaseRejection
        ? "The batch was rejected. No questions were imported."
        : "The result could not be confirmed. Retry with the same batch.",
      retryable: !confirmedDatabaseRejection,
    };
  }

  const result = Array.isArray(data) ? data[0] : data;
  revalidatePath(`/teacher/exams/${examId}`);
  return {
    ok: true,
    count: Number(result?.question_count ?? items.length),
    alreadyCompleted: false,
  };
}

export async function removeStagedQuestionImages(input: unknown) {
  const viewer = await requireRole("teacher");
  const parsed = stagedCleanupSchema.safeParse(input);
  if (!parsed.success || !pathsBelongToBatch(parsed.data.paths, viewer.id, parsed.data.batchId)) {
    return { ok: false, message: "Invalid cleanup request." } as const;
  }

  const supabase = await createClient();
  const { data: batch, error: batchError } = await supabase
    .from("question_import_batches")
    .select("status")
    .eq("id", parsed.data.batchId)
    .maybeSingle();
  if (batchError || batch?.status === "completed") {
    return { ok: false, message: "Completed import images cannot be removed." } as const;
  }

  if (parsed.data.paths.length) {
    const { error } = await supabase.storage.from("question-images").remove(parsed.data.paths);
    if (error) return { ok: false, message: "Staged images could not be removed." } as const;
  }
  return { ok: true } as const;
}
