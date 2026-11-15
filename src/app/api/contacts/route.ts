import { requireSession } from "@/lib/auth";
import { addContacts, listContacts, type NewContact } from "@/lib/contacts";
import { KINDS, type Kind } from "@/lib/types";

const isKind = (k: unknown): k is Kind => typeof k === "string" && k in KINDS;

export async function GET(request: Request) {
  const s = await requireSession(request);
  if (s instanceof Response) return s;
  const kind = new URL(request.url).searchParams.get("kind");
  return Response.json({ contacts: await listContacts(s, isKind(kind) ? kind : undefined) });
}

/** Create one contact or a bulk list: { kind, items: [...], source? } */
export async function POST(request: Request) {
  const s = await requireSession(request);
  if (s instanceof Response) return s;
  const body = (await request.json().catch(() => null)) as { kind?: string; items?: NewContact[]; source?: string } | null;
  if (!body || !isKind(body.kind) || !Array.isArray(body.items) || !body.items.length) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  const items = body.items.slice(0, 2000).map((i) =>
    // employees add contacts for themselves
    s.role === "employee" ? { ...i, assignedTo: s.employeeId } : i,
  );
  const { created, skipped } = await addContacts(body.kind, items, body.source || "Manual");
  return Response.json({ created: created.length, skipped });
}
