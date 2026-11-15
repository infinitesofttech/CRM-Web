import { isConfigured } from "@/lib/auth";
import { storageMode } from "@/lib/store";

export async function GET() {
  return Response.json({ ok: true, storage: storageMode, authConfigured: isConfigured() });
}
