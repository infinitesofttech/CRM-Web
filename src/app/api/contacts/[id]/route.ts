import { requireSession } from "@/lib/auth";
import { getContact, now } from "@/lib/contacts";
import { normalizePhone } from "@/lib/phone";
import { getOne, putMany, remove } from "@/lib/store";
import { KINDS, type Contact, type Employee, type Session } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

async function load(id: string, s: Session) {
  const c = await getContact(id);
  if (!c) return Response.json({ error: "Not found" }, { status: 404 });
  if (s.role === "employee" && c.assignedTo !== s.employeeId) return Response.json({ error: "Forbidden" }, { status: 403 });
  return c;
}

export async function PATCH(request: Request, { params }: Ctx) {
  const s = await requireSession(request);
  if (s instanceof Response) return s;
  const c = await load((await params).id, s);
  if (c instanceof Response) return c;
  const b = (await request.json().catch(() => ({}))) as Partial<Contact>;

  const next: Contact = { ...c, updatedAt: now() };
  if (typeof b.name === "string") next.name = b.name.trim().slice(0, 120);
  if (typeof b.company === "string") next.company = b.company.trim().slice(0, 160);
  if (typeof b.email === "string") next.email = b.email.trim().slice(0, 160);
  if (typeof b.notes === "string") next.notes = b.notes.slice(0, 2000);
  if (typeof b.followUp === "string") next.followUp = b.followUp.slice(0, 10);
  if (typeof b.phone === "string") {
    const p = normalizePhone(b.phone);
    if (b.phone.trim() && !p) return Response.json({ error: "Invalid mobile number" }, { status: 400 });
    next.phone = p;
  }
  if (typeof b.status === "string" && KINDS[c.kind].statuses.includes(b.status)) next.status = b.status;
  if (s.role === "admin" && "assignedTo" in b) {
    if (b.assignedTo && !(await getOne<Employee>("employees", b.assignedTo))) {
      return Response.json({ error: "Unknown employee" }, { status: 400 });
    }
    next.assignedTo = b.assignedTo || null;
  }
  await putMany("contacts", [next]);
  return Response.json({ contact: next });
}

export async function DELETE(request: Request, { params }: Ctx) {
  const s = await requireSession(request, true);
  if (s instanceof Response) return s;
  await remove("contacts", (await params).id);
  return Response.json({ ok: true });
}
