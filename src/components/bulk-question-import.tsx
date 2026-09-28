"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Images, RotateCcw, Trash2, Upload } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  commitBulkQuestionImport,
  removeStagedQuestionImages,
} from "@/app/actions/question-import";
import {
  type AnswerOption,
  hasSupportedImageSignature,
  imageExtension,
  isQuestionImageType,
  QUESTION_IMAGE_TYPES,
  QUESTION_IMPORT_LIMITS,
  stagingPrefix,
} from "@/lib/question-import";
import { createClient } from "@/lib/supabase/browser";

type UploadStatus = "validating" | "uploading" | "uploaded" | "failed";
type PreviewItem = {
  id: string;
  originalFilename: string;
  size: number;
  mimeType: string;
  previewUrl: string;
  imagePath: string | null;
  sha256: string | null;
  correctOption: AnswerOption | null;
  status: UploadStatus;
  error?: string;
};

type PersistedDraft = {
  batchId: string;
  items: Array<Pick<PreviewItem, "originalFilename" | "size" | "mimeType" | "imagePath" | "sha256" | "correctOption">>;
};

const answerOptions: AnswerOption[] = ["A", "B", "C", "D"];

function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.ceil(bytes / 1024)} KB`;
}

async function sha256(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

async function imageDecodes(file: File) {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    const valid = bitmap.width > 0 && bitmap.height > 0;
    bitmap.close();
    return valid;
  }
  return new Promise<boolean>((resolve) => {
    const url = URL.createObjectURL(file);
    const image = new window.Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image.naturalWidth > 0 && image.naturalHeight > 0);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(false);
    };
    image.src = url;
  });
}

async function runBounded(tasks: Array<() => Promise<void>>, concurrency: number) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
      while (next < tasks.length) {
        const index = next++;
        await tasks[index]();
      }
    }),
  );
}

export function BulkQuestionImport({
  examId,
  sectionId,
  userId,
}: {
  examId: string;
  sectionId: string;
  userId: string;
}) {
  const router = useRouter();
  const storageKey = `summit-question-import:${sectionId}`;
  const [batchId, setBatchId] = useState("");
  const [items, setItems] = useState<PreviewItem[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const itemsRef = useRef(items);
  const cancelledIds = useRef(new Set<string>());

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const updateItem = useCallback((id: string, patch: Partial<PreviewItem>) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  useEffect(() => {
    let active = true;
    const restore = async () => {
      const saved = localStorage.getItem(storageKey);
      if (!saved) {
        if (active) {
          setBatchId(crypto.randomUUID());
          setHydrated(true);
        }
        return;
      }

      try {
        const draft = JSON.parse(saved) as PersistedDraft;
        const prefix = stagingPrefix(userId, draft.batchId);
        if (
          !draft.batchId ||
          !Array.isArray(draft.items) ||
          draft.items.some((item) => !item.imagePath?.startsWith(prefix))
        ) {
          throw new Error("Invalid saved draft");
        }
        const paths = draft.items.map((item) => item.imagePath as string);
        const supabase = createClient();
        const { data } = await supabase.storage
          .from("question-images")
          .createSignedUrls(paths, 60 * 60);
        const urls = new Map<string, string>(
          (data ?? []).flatMap((entry: { path?: string; signedUrl?: string }) =>
            entry.path && entry.signedUrl ? [[entry.path, entry.signedUrl]] : [],
          ),
        );
        if (!active) return;
        setBatchId(draft.batchId);
        setItems(
          draft.items.map((item) => ({
            id: crypto.randomUUID(),
            originalFilename: item.originalFilename,
            size: item.size,
            mimeType: item.mimeType,
            imagePath: item.imagePath,
            sha256: item.sha256,
            correctOption: item.correctOption,
            previewUrl: urls.get(item.imagePath as string) ?? "",
            status: urls.has(item.imagePath as string) ? "uploaded" : "failed",
            error: urls.has(item.imagePath as string) ? undefined : "Staged image is unavailable.",
          })),
        );
        setMessage("Your staged import was restored.");
      } catch {
        localStorage.removeItem(storageKey);
        if (active) setBatchId(crypto.randomUUID());
      } finally {
        if (active) setHydrated(true);
      }
    };
    void restore();
    return () => {
      active = false;
    };
  }, [storageKey, userId]);

  useEffect(() => {
    if (!hydrated || !batchId) return;
    const uploaded = items.filter(
      (item) => item.status !== "failed" && item.imagePath && item.sha256,
    );
    if (!uploaded.length) {
      localStorage.removeItem(storageKey);
      return;
    }
    const draft: PersistedDraft = {
      batchId,
      items: uploaded.map((item) => ({
        originalFilename: item.originalFilename,
        size: item.size,
        mimeType: item.mimeType,
        imagePath: item.imagePath,
        sha256: item.sha256,
        correctOption: item.correctOption,
      })),
    };
    localStorage.setItem(storageKey, JSON.stringify(draft));
  }, [batchId, hydrated, items, storageKey]);

  const addFiles = useCallback(
    async (selected: File[]) => {
      if (!batchId || !selected.length) return;
      setMessage(null);
      if (itemsRef.current.length + selected.length > QUESTION_IMPORT_LIMITS.maxFiles) {
        setMessage(`Choose no more than ${QUESTION_IMPORT_LIMITS.maxFiles} images per import.`);
        return;
      }
      const existingBytes = itemsRef.current.reduce((sum, item) => sum + item.size, 0);
      const selectedBytes = selected.reduce((sum, file) => sum + file.size, 0);
      if (existingBytes + selectedBytes > QUESTION_IMPORT_LIMITS.maxTotalBytes) {
        setMessage(
          `The batch must be under ${formatBytes(QUESTION_IMPORT_LIMITS.maxTotalBytes)} in total.`,
        );
        return;
      }

      const newItems = selected.map<PreviewItem>((file) => ({
        id: crypto.randomUUID(),
        originalFilename: file.name.slice(0, 255) || "question-image",
        size: file.size,
        mimeType: file.type,
        previewUrl: URL.createObjectURL(file),
        imagePath: null,
        sha256: null,
        correctOption: null,
        status: "validating",
      }));
      setItems((current) => [...current, ...newItems]);

      const knownHashes = new Set(
        itemsRef.current.flatMap((item) => (item.sha256 ? [item.sha256] : [])),
      );
      const tasks = newItems.map((item, index) => async () => {
        const file = selected[index];
        const fail = (error: string) => updateItem(item.id, { status: "failed", error });
        if (!isQuestionImageType(file.type)) {
          fail("Use a PNG, JPEG, or WebP image.");
          return;
        }
        if (!file.size || file.size > QUESTION_IMPORT_LIMITS.maxFileBytes) {
          fail(`Each image must be under ${formatBytes(QUESTION_IMPORT_LIMITS.maxFileBytes)}.`);
          return;
        }

        try {
          const signature = new Uint8Array(await file.slice(0, 16).arrayBuffer());
          if (!hasSupportedImageSignature(signature, file.type) || !(await imageDecodes(file))) {
            fail("This file is not a readable image.");
            return;
          }
          const hash = await sha256(file);
          if (knownHashes.has(hash)) {
            fail("This image is already in the current batch.");
            return;
          }
          knownHashes.add(hash);
          if (cancelledIds.current.has(item.id)) return;

          const path = `${stagingPrefix(userId, batchId)}${crypto.randomUUID()}.${
            imageExtension[file.type]
          }`;
          updateItem(item.id, { status: "uploading", sha256: hash, imagePath: path });
          const supabase = createClient();
          const { error } = await supabase.storage.from("question-images").upload(path, file, {
            cacheControl: "3600",
            contentType: file.type,
            upsert: false,
          });
          if (error) {
            fail("Upload failed. Remove this image and try again.");
            return;
          }
          if (cancelledIds.current.has(item.id)) {
            await removeStagedQuestionImages({ batchId, paths: [path] });
            return;
          }
          updateItem(item.id, { status: "uploaded", imagePath: path, sha256: hash });
        } catch {
          fail("The image could not be validated or uploaded.");
        }
      });

      await runBounded(tasks, QUESTION_IMPORT_LIMITS.uploadConcurrency);
    },
    [batchId, updateItem, userId],
  );

  const removeItem = async (item: PreviewItem) => {
    cancelledIds.current.add(item.id);
    if (item.imagePath && item.status === "uploaded") {
      const result = await removeStagedQuestionImages({ batchId, paths: [item.imagePath] });
      if (!result.ok) {
        setMessage(result.message);
        cancelledIds.current.delete(item.id);
        return;
      }
    }
    if (item.previewUrl.startsWith("blob:")) URL.revokeObjectURL(item.previewUrl);
    setItems((current) => current.filter((candidate) => candidate.id !== item.id));
  };

  const move = (index: number, direction: -1 | 1) => {
    setItems((current) => {
      const destination = index + direction;
      if (destination < 0 || destination >= current.length) return current;
      const reordered = [...current];
      [reordered[index], reordered[destination]] = [reordered[destination], reordered[index]];
      return reordered;
    });
  };

  const cancel = async () => {
    const snapshot = itemsRef.current;
    snapshot.forEach((item) => cancelledIds.current.add(item.id));
    const paths = snapshot.flatMap((item) =>
      item.imagePath && item.status === "uploaded" ? [item.imagePath] : [],
    );
    const result = await removeStagedQuestionImages({ batchId, paths });
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    snapshot.forEach((item) => {
      if (item.previewUrl.startsWith("blob:")) URL.revokeObjectURL(item.previewUrl);
    });
    localStorage.removeItem(storageKey);
    setItems([]);
    setBatchId(crypto.randomUUID());
    setMessage("Import cancelled. Staged images were removed.");
  };

  const summary = useMemo(() => {
    const missingAnswers = items.filter((item) => !item.correctOption).length;
    const invalid = items.filter((item) => item.status === "failed").length;
    const pending = items.filter(
      (item) => item.status === "validating" || item.status === "uploading",
    ).length;
    const ready = items.filter(
      (item) => item.status === "uploaded" && item.correctOption,
    ).length;
    return { missingAnswers, invalid, pending, ready };
  }, [items]);

  const canImport =
    items.length > 0 &&
    summary.ready === items.length &&
    summary.invalid === 0 &&
    summary.pending === 0 &&
    !importing;

  const commit = async () => {
    if (!canImport) return;
    setImporting(true);
    setMessage(null);
    const result = await commitBulkQuestionImport({
      batchId,
      examId,
      sectionId,
      items: items.map((item, index) => ({
        position: index + 1,
        imagePath: item.imagePath,
        correctOption: item.correctOption,
        originalFilename: item.originalFilename,
        sha256: item.sha256,
      })),
    });
    setImporting(false);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    items.forEach((item) => {
      if (item.previewUrl.startsWith("blob:")) URL.revokeObjectURL(item.previewUrl);
    });
    localStorage.removeItem(storageKey);
    setItems([]);
    setBatchId(crypto.randomUUID());
    setMessage(
      result.alreadyCompleted
        ? `${result.count} questions were already imported. No duplicates were created.`
        : `${result.count} questions imported successfully.`,
    );
    router.refresh();
  };

  return (
    <details className="mt-5 rounded-xl border border-dashed border-brand/30 bg-green-50/30 p-4">
      <summary className="cursor-pointer rounded-lg py-1 font-semibold text-brand">
        Bulk add questions from photos
      </summary>
      <div className="mt-5">
        <label
          className={`grid cursor-pointer place-items-center rounded-2xl border-2 border-dashed px-5 py-9 text-center transition ${
            dragging ? "border-brand bg-green-50" : "border-black/15 bg-white hover:border-brand/60"
          }`}
          onDragEnter={() => setDragging(true)}
          onDragLeave={() => setDragging(false)}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void addFiles(Array.from(event.dataTransfer.files));
          }}
        >
          <Images className="text-brand" size={30} />
          <span className="mt-3 font-bold">Drop question images here</span>
          <span className="mt-1 text-sm text-black/50">or choose multiple PNG, JPEG, or WebP files</span>
          <input
            className="sr-only"
            type="file"
            multiple
            accept={QUESTION_IMAGE_TYPES.join(",")}
            onChange={(event) => {
              void addFiles(Array.from(event.currentTarget.files ?? []));
              event.currentTarget.value = "";
            }}
          />
          <span className="btn-secondary mt-5">
            <Upload size={16} /> Choose images
          </span>
          <span className="mt-3 text-xs text-black/45">
            Up to {QUESTION_IMPORT_LIMITS.maxFiles} images, {formatBytes(QUESTION_IMPORT_LIMITS.maxFileBytes)} each, {formatBytes(QUESTION_IMPORT_LIMITS.maxTotalBytes)} total
          </span>
        </label>

        {items.length > 0 && (
          <>
            <div className="mt-5 grid gap-2 rounded-xl bg-white p-4 text-sm sm:grid-cols-4" aria-live="polite">
              <span><b>{items.length}</b> selected</span>
              <span className="text-green-800"><b>{summary.ready}</b> ready</span>
              <span className={summary.missingAnswers ? "text-amber-700" : "text-black/50"}><b>{summary.missingAnswers}</b> missing answers</span>
              <span className={summary.invalid ? "text-red-700" : "text-black/50"}><b>{summary.invalid}</b> invalid</span>
            </div>

            <ol className="mt-5 grid gap-4 lg:grid-cols-2">
              {items.map((item, index) => (
                <li className={`rounded-2xl border bg-white p-4 ${!item.correctOption || item.status === "failed" ? "border-amber-300" : "border-black/10"}`} key={item.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wide text-brand">Question {index + 1}</p>
                      <p className="mt-1 max-w-64 truncate text-xs text-black/45" title={item.originalFilename}>{item.originalFilename} · {formatBytes(item.size)}</p>
                    </div>
                    <div className="flex gap-1">
                      <button className="icon-button" type="button" disabled={index === 0} onClick={() => move(index, -1)} aria-label={`Move question ${index + 1} up`}><ArrowUp size={15} /></button>
                      <button className="icon-button" type="button" disabled={index === items.length - 1} onClick={() => move(index, 1)} aria-label={`Move question ${index + 1} down`}><ArrowDown size={15} /></button>
                      <button className="icon-button text-red-700" type="button" onClick={() => void removeItem(item)} aria-label={`Remove question ${index + 1}`}><Trash2 size={15} /></button>
                    </div>
                  </div>
                  <div className="mt-4 grid aspect-[4/3] place-items-center overflow-hidden rounded-xl bg-black/[.035]">
                    {item.previewUrl ? <Image unoptimized width={800} height={600} className="max-h-full h-auto w-auto max-w-full object-contain" src={item.previewUrl} alt={`Preview of ${item.originalFilename}`} /> : <span className="text-sm text-black/40">Preview unavailable</span>}
                  </div>
                  <p className={`mt-3 text-xs font-semibold ${item.status === "failed" ? "text-red-700" : item.status === "uploaded" ? "text-green-700" : "text-black/50"}`}>
                    {item.status === "validating" && "Validating image…"}
                    {item.status === "uploading" && "Uploading staged image…"}
                    {item.status === "uploaded" && "Upload ready"}
                    {item.status === "failed" && item.error}
                  </p>
                  <fieldset className="mt-4" disabled={item.status !== "uploaded"}>
                    <legend className="text-sm font-bold">Correct answer</legend>
                    <div className="mt-2 grid grid-cols-4 gap-2">
                      {answerOptions.map((answer) => (
                        <label className={`grid min-h-11 cursor-pointer place-items-center rounded-xl border font-bold transition ${item.correctOption === answer ? "border-brand bg-brand text-white" : "border-black/10 hover:border-brand"}`} key={answer}>
                          <input className="sr-only" type="radio" name={`correct-${item.id}`} value={answer} checked={item.correctOption === answer} onChange={() => updateItem(item.id, { correctOption: answer })} />
                          {answer}
                        </label>
                      ))}
                    </div>
                    {!item.correctOption && <p className="mt-2 text-xs font-semibold text-amber-700">Select one answer before importing.</p>}
                  </fieldset>
                </li>
              ))}
            </ol>

            <div className="mt-6 flex flex-col-reverse gap-3 border-t border-black/10 pt-5 sm:flex-row sm:items-center sm:justify-between">
              <button className="btn-ghost" type="button" disabled={importing} onClick={() => void cancel()}><RotateCcw size={16} /> Cancel import</button>
              <button className="btn-primary" type="button" disabled={!canImport} onClick={() => void commit()}>{importing ? `Importing ${items.length} questions…` : `Import ${items.length} questions`}</button>
            </div>
          </>
        )}
        {message && <p className="mt-4 rounded-xl bg-white p-3 text-sm font-medium" role="status">{message}</p>}
      </div>
    </details>
  );
}
