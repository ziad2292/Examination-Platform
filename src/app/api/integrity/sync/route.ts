import { handleIntegrityRequest } from "@/lib/integrity-handler";
export async function POST(request: Request) {
  return handleIntegrityRequest(request, "sync");
}
