import { notFound } from "next/navigation";
import ContactsView from "@/components/ContactsView";
import { getSession } from "@/lib/auth";
import { listContacts } from "@/lib/contacts";
import { getAll } from "@/lib/store";
import { SLUG_TO_KIND, type Employee, type PublicEmployee } from "@/lib/types";

export default async function KindPage({ params }: { params: Promise<{ kind: string }> }) {
  const kind = SLUG_TO_KIND[(await params).kind];
  if (!kind) notFound();
  const session = (await getSession())!;
  // Fetch on the server so the page arrives with its data (no second round trip from the browser).
  const [contacts, emps] = await Promise.all([
    listContacts(session, kind),
    session.role === "admin" ? getAll<Employee>("employees") : Promise.resolve([] as Employee[]),
  ]);
  const employees: PublicEmployee[] = emps
    .map(({ passwordHash: _h, ...e }) => e)
    .sort((a, b) => a.name.localeCompare(b.name));
  return <ContactsView kind={kind} role={session.role} initialContacts={contacts} initialEmployees={employees} />;
}
