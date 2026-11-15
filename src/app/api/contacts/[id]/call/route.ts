import { requireSession } from "@/lib/auth";
import { getContact, now } from "@/lib/contacts";
import { putMany } from "@/lib/store";
import { CALL_OUTCOMES, KINDS } from "@/lib/types";

/** Log a call: { outcome, note, status?, followUp? } */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await requireSession(request);
  if (s instanceof Response) return s;
  const c = await getContact((await params).id);
  if (!c) return Response.json({ error: "Not found" }, { status: 404 });
  if (s.role === "employee" && c.assignedTo !== s.employeeId) return Response.json({ error: "Forbidden" }, { status: 403 });

  const b = (await request.json().catch(() => ({}))) as { outcome?: string; note?: string; status?: string; followUp?: string };
  if (!b.outcome || !CALL_OUTCOMES.includes(b.outcome)) return Response.json({ error: "Pick a call outcome" }, { status: 400 });

  const next = {
    ...c,
    calls: [...c.calls, { at: now(), by: s.name, outcome: b.outcome, note: (b.note ?? "").slice(0, 1000) }],
    status: b.status && KINDS[c.kind].statuses.includes(b.status) ? b.status : c.status,
    followUp: typeof b.followUp === "string" ? b.followUp.slice(0, 10) : c.followUp,
    updatedAt: now(),
  };
  await putMany("contacts", [next]);
  return Response.json({ contact: next });
}
