import { requireSession } from "@/lib/auth";
import { now } from "@/lib/contacts";
import { getAll, putMany, remove } from "@/lib/store";
import type { Contact } from "@/lib/types";

/** Remove an employee; their contacts become unassigned again. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await requireSession(request, true);
  if (s instanceof Response) return s;
  const { id } = await params;
  const mine = (await getAll<Contact>("contacts")).filter((c) => c.assignedTo === id);
  await putMany("contacts", mine.map((c) => ({ ...c, assignedTo: null, updatedAt: now() })));
  await remove("employees", id);
  return Response.json({ ok: true, unassigned: mine.length });
}
