import { requireSession } from "@/lib/auth";
import { parseLines } from "@/lib/parse";

/** Admin: fetch a public page / JSON link (e.g. an expo exhibitor list) and extract name + mobile numbers. */

function blockedHost(h: string) {
  return (
    h === "localhost" ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) ||
    h.includes(":")
  );
}

function jsonToLines(data: unknown, out: string[] = []): string[] {
  if (Array.isArray(data)) data.forEach((d) => jsonToLines(d, out));
  else if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    const pick = (re: RegExp) =>
      Object.entries(o).find(([k, v]) => re.test(k) && (typeof v === "string" || typeof v === "number"))?.[1];
    const phone = pick(/phone|mobile|contact|whatsapp/i);
    if (phone) out.push([pick(/company|firm|business|org|brand|exhibitor/i), pick(/^name$|person|owner|full/i), phone, pick(/mail/i)].filter(Boolean).join(", "));
    Object.values(o).forEach((v) => typeof v === "object" && jsonToLines(v, out));
  }
  return out;
}

export async function POST(request: Request) {
  const s = await requireSession(request, true);
  if (s instanceof Response) return s;
  const { url } = (await request.json().catch(() => ({}))) as { url?: string };
  let u: URL;
  try {
    u = new URL(String(url));
  } catch {
    return Response.json({ error: "Enter a valid link" }, { status: 400 });
  }
  if (!/^https?:$/.test(u.protocol) || blockedHost(u.hostname)) return Response.json({ error: "Link not allowed" }, { status: 400 });

  try {
    const res = await fetch(u, { signal: AbortSignal.timeout(15000), headers: { "User-Agent": "Mozilla/5.0 CRM-Importer" } });
    const text = (await res.text()).slice(0, 3_000_000);
    let lines = text;
    try {
      lines = jsonToLines(JSON.parse(text)).join("\n");
    } catch {
      lines = text
        .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
        .replace(/<\/(tr|li|p|div|h\d|br)>|<br\s*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&");
    }
    const rows = parseLines(lines);
    return Response.json({
      rows,
      note: rows.length
        ? undefined
        : "No phone numbers found on that page. Many expo sites load the exhibitor list with JavaScript - open the list in your browser, select all, copy, and use 'Paste' instead.",
    });
  } catch {
    return Response.json({ error: "Could not open that link" }, { status: 502 });
  }
}
