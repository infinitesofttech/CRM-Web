import { requireSession } from "@/lib/auth";
import { distribute } from "@/lib/contacts";
import { KINDS, type Kind } from "@/lib/types";

/** Admin: split contacts of a kind equally between employees. { kind, employeeIds, reassign } */
export async function POST(request: Request) {
  const s = await requireSession(request, true);
  if (s instanceof Response) return s;
  const b = (await request.json().catch(() => ({}))) as { kind?: string; employeeIds?: string[]; reassign?: boolean };
  if (!b.kind || !(b.kind in KINDS) || !Array.isArray(b.employeeIds) || !b.employeeIds.length) {
    return Response.json({ error: "Choose at least one employee" }, { status: 400 });
  }
  const n = await distribute(b.kind as Kind, b.employeeIds, !!b.reassign);
  return Response.json({ assigned: n });
}
