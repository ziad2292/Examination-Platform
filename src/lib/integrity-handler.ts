import { createClient } from "@/lib/supabase/server";
import { syncSchema } from "@/lib/integrity";
export async function handleIntegrityRequest(
  request: Request,
  mode: "session" | "sync" | "exit",
) {
  if (process.env.NEXT_PUBLIC_INTEGRITY_ENABLED !== "true")
    return Response.json({ enabled: false, acknowledged: [] });
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return Response.json({ error: "Invalid origin" }, { status: 403 });
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return Response.json({ error: "JSON required" }, { status: 415 });
  if (Number(request.headers.get("content-length") ?? 0) > 32768)
    return Response.json({ error: "Batch too large" }, { status: 413 });
  let body: string;
  try {
    const reader = request.body?.getReader();
    if (!reader)
      return Response.json({ error: "Body required" }, { status: 400 });
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 32768) {
        await reader.cancel();
        return Response.json({ error: "Batch too large" }, { status: 413 });
      }
      chunks.push(part.value);
    }
    body = new TextDecoder().decode(Buffer.concat(chunks));
  } catch {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }
  let input;
  try {
    input = syncSchema.safeParse(JSON.parse(body));
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!input.success)
    return Response.json({ error: "Invalid observations" }, { status: 400 });
  if (
    mode === "exit" &&
    input.data.observations.some(
      (e) => !["exit", "offline", "reload", "reconnect"].includes(e.type),
    )
  )
    return Response.json({ error: "Lifecycle events only" }, { status: 400 });
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user)
    return Response.json({ error: "Authentication required" }, { status: 401 });
  const { data, error } = await db.rpc("integrity_sync", {
    target_attempt: input.data.attemptId,
    browser_instance: input.data.browserInstanceId,
    document_instance: input.data.documentId,
    observations: input.data.observations,
    registration: mode === "session",
  });
  if (error) {
    const status =
      error.code === "42501" ? 403 : error.code === "54000" ? 429 : 400;
    return Response.json(
      {
        error:
          status === 403
            ? "Monitoring session unavailable"
            : status === 429
              ? "Observation rate exceeded"
              : "Observations rejected",
      },
      { status },
    );
  }
  return Response.json(data, { headers: { "Cache-Control": "no-store" } });
}
