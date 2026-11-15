import { addContacts } from "@/lib/contacts";

/**
 * Website contact form -> CRM lead.
 * POST { key, name, phone, email, company, message }   (key must equal LEAD_KEY)
 */
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export function OPTIONS() {
  return new Response(null, { status: 204, headers: cors });
}

export async function POST(request: Request) {
  const expected = (process.env.LEAD_KEY ?? "").trim();
  if (!expected) return Response.json({ error: "Not enabled" }, { status: 503, headers: cors });
  const b = (await request.json().catch(() => ({}))) as Record<string, string>;
  if (b.key !== expected) return Response.json({ error: "Forbidden" }, { status: 403, headers: cors });
  if (b.website) return Response.json({ ok: true }, { headers: cors }); // honeypot
  const { created } = await addContacts(
    "lead",
    [{ name: b.name, phone: b.phone || "", email: b.email, company: b.company, notes: b.message }],
    "Website",
  );
  return Response.json({ ok: true, created: created.length }, { headers: cors });
}
