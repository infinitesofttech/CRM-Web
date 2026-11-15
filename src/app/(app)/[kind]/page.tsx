import { notFound } from "next/navigation";
import ContactsView from "@/components/ContactsView";
import { getSession } from "@/lib/auth";
import { SLUG_TO_KIND } from "@/lib/types";

export default async function KindPage({ params }: { params: Promise<{ kind: string }> }) {
  const kind = SLUG_TO_KIND[(await params).kind];
  if (!kind) notFound();
  const session = (await getSession())!;
  return <ContactsView kind={kind} role={session.role} />;
}
