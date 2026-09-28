import { describe, expect, it } from "vitest";
import {
  bulkQuestionImportSchema,
  hasSupportedImageSignature,
  QUESTION_IMPORT_LIMITS,
  stagingPrefix,
} from "./question-import";

const ids = {
  batchId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  examId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  sectionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
};

function item(position: number, suffix = String(position)) {
  return {
    position,
    imagePath: `question-import-staging/user/${ids.batchId}/${suffix}.png`,
    correctOption: "A" as const,
    originalFilename: `question-${suffix}.png`,
    sha256: suffix.padStart(64, "0"),
  };
}

describe("bulk question import validation", () => {
  it("accepts a contiguous, complete batch", () => {
    expect(bulkQuestionImportSchema.safeParse({ ...ids, items: [item(1), item(2)] }).success).toBe(
      true,
    );
  });

  it("rejects missing positions and duplicate content", () => {
    const duplicate = item(3, "1");
    expect(
      bulkQuestionImportSchema.safeParse({ ...ids, items: [item(1), duplicate] }).success,
    ).toBe(false);
  });

  it("rejects oversized batches", () => {
    const items = Array.from({ length: QUESTION_IMPORT_LIMITS.maxFiles + 1 }, (_, index) =>
      item(index + 1),
    );
    expect(bulkQuestionImportSchema.safeParse({ ...ids, items }).success).toBe(false);
  });
});

describe("question image signatures", () => {
  it("recognizes PNG, JPEG, and WebP signatures", () => {
    expect(
      hasSupportedImageSignature(
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        "image/png",
      ),
    ).toBe(true);
    expect(hasSupportedImageSignature(new Uint8Array([0xff, 0xd8, 0xff]), "image/jpeg")).toBe(
      true,
    );
    expect(
      hasSupportedImageSignature(
        new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]),
        "image/webp",
      ),
    ).toBe(true);
    expect(hasSupportedImageSignature(new Uint8Array([60, 115, 118, 103]), "image/png")).toBe(
      false,
    );
  });
});

it("builds a teacher-and-batch-scoped staging prefix", () => {
  expect(stagingPrefix("teacher", "batch")).toBe(
    "question-import-staging/teacher/batch/",
  );
});
