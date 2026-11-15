import { randomUUID } from "crypto";
import { getAll, getOne, putMany } from "./store";
import { normalizePhone } from "./phone";
import { KINDS, type Contact, type Employee, type Kind, type Session } from "./types";

export const now = () => new Date().toISOString();

export async function listContacts(session: Session, kind?: Kind): Promise<Contact[]> {
  let all = await getAll<Contact>("contacts");
  if (kind) all = all.filter((c) => c.kind === kind);
  if (session.role === "employee") all = all.filter((c) => c.assignedTo === session.employeeId);
  return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export type NewContact = Partial<
  Pick<Contact, "name" | "company" | "phone" | "email" | "website" | "source" | "notes" | "status" | "assignedTo">
>;

/** Inserts contacts, skipping invalid or duplicate phone numbers inside the same kind. */
export async function addContacts(kind: Kind, items: NewContact[], defaultSource: string) {
  const existing = await getAll<Contact>("contacts");
  const seen = new Set(existing.filter((c) => c.kind === kind && c.phone).map((c) => c.phone));
  const created: Contact[] = [];
  let skipped = 0;
  for (const it of items) {
    const phone = normalizePhone(it.phone ?? "");
    if ((it.phone && !phone) || (phone && seen.has(phone)) || (!phone && !(it.name || it.company))) {
      skipped++;
      continue;
    }
    if (phone) seen.add(phone);
    const t = now();
    created.push({
      id: randomUUID(),
      kind,
      name: (it.name ?? "").trim().slice(0, 120),
      company: (it.company ?? "").trim().slice(0, 160),
      phone,
      email: (it.email ?? "").trim().slice(0, 160),
      website: (it.website ?? "").trim().slice(0, 200),
      source: (it.source ?? defaultSource).slice(0, 80),
      status: it.status && KINDS[kind].statuses.includes(it.status) ? it.status : "New",
      assignedTo: it.assignedTo ?? null,
      notes: (it.notes ?? "").slice(0, 2000),
      followUp: "",
      calls: [],
      createdAt: t,
      updatedAt: t,
    });
  }
  await putMany("contacts", created);
  return { created, skipped };
}

/** Round-robin contacts of a kind across the chosen employees. */
export async function distribute(kind: Kind, employeeIds: string[], reassign: boolean) {
  const [contacts, employees] = await Promise.all([getAll<Contact>("contacts"), getAll<Employee>("employees")]);
  const valid = employeeIds.filter((id) => employees.some((e) => e.id === id));
  if (!valid.length) return 0;
  const pool = contacts
    .filter((c) => c.kind === kind && (reassign || !c.assignedTo))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const changed = pool.map((c, i) => ({ ...c, assignedTo: valid[i % valid.length], updatedAt: now() }));
  await putMany("contacts", changed);
  return changed.length;
}

export const getContact = (id: string) => getOne<Contact>("contacts", id);
