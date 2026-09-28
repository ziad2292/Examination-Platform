import { z } from "zod";

export const QUESTION_IMPORT_LIMITS = {
  maxFiles: 50,
  maxFileBytes: 8 * 1024 * 1024,
  maxTotalBytes: 100 * 1024 * 1024,
  uploadConcurrency: 3,
  abandonedAfterHours: 24,
} as const;

export const QUESTION_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type QuestionImageType = (typeof QUESTION_IMAGE_TYPES)[number];
export type AnswerOption = "A" | "B" | "C" | "D";

export const imageExtension: Record<QuestionImageType, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export function isQuestionImageType(value: string): value is QuestionImageType {
  return QUESTION_IMAGE_TYPES.includes(value as QuestionImageType);
}

export function hasSupportedImageSignature(bytes: Uint8Array, mimeType: string) {
  if (mimeType === "image/png") {
    return (
      bytes.length >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    );
  }
  if (mimeType === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mimeType === "image/webp") {
    return (
      bytes.length >= 12 &&
      String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
    );
  }
  return false;
}

export function stagingPrefix(userId: string, batchId: string) {
  return `question-import-staging/${userId}/${batchId}/`;
}

const importItemSchema = z.object({
  position: z.number().int().positive().max(QUESTION_IMPORT_LIMITS.maxFiles),
  imagePath: z.string().min(1).max(500),
  correctOption: z.enum(["A", "B", "C", "D"]),
  originalFilename: z.string().min(1).max(255),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

export const bulkQuestionImportSchema = z
  .object({
    batchId: z.guid(),
    examId: z.guid(),
    sectionId: z.guid(),
    items: z.array(importItemSchema).min(1).max(QUESTION_IMPORT_LIMITS.maxFiles),
  })
  .superRefine((value, context) => {
    const positions = new Set(value.items.map((item) => item.position));
    const paths = new Set(value.items.map((item) => item.imagePath));
    const hashes = new Set(value.items.map((item) => item.sha256));

    if (
      positions.size !== value.items.length ||
      value.items.some((item, index) => item.position !== index + 1)
    ) {
      context.addIssue({ code: "custom", message: "Question positions must be contiguous." });
    }
    if (paths.size !== value.items.length) {
      context.addIssue({ code: "custom", message: "Duplicate staged image path." });
    }
    if (hashes.size !== value.items.length) {
      context.addIssue({ code: "custom", message: "Duplicate image content." });
    }
  });

export const stagedCleanupSchema = z.object({
  batchId: z.guid(),
  paths: z.array(z.string().min(1).max(500)).max(QUESTION_IMPORT_LIMITS.maxFiles),
});
