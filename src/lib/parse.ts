import { normalizePhone } from "./phone";

export type Parsed = { name: string; company: string; phone: string; email: string; website: string };

const PHONE_RE = /(?:\+?\s*91[\s-]*)?0?[6-9](?:[\s-]?\d){9}/g;
const SITE_RE = /(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|in|co\.in|org|net|biz|info)(?:\/[^\s,;|]*)?/i;
const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;

/** Pull every valid Indian mobile number out of free text (OCR output, pasted text, web page text). */
export function extractNumbers(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(PHONE_RE)) {
    const p = normalizePhone(m[0]);
    if (p) out.add(p);
  }
  return [...out];
}

/** Line-based parser: each line may carry "Company, Name, phone, email" in any order. */
export function parseLines(text: string): Parsed[] {
  const rows: Parsed[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const phones = extractNumbers(line);
    if (!phones.length) continue;
    const email = line.match(EMAIL_RE)?.[0] ?? "";
    const noEmail = line.replace(EMAIL_RE, " ");
    const website = noEmail.match(SITE_RE)?.[0] ?? "";
    const rest = noEmail
      .replace(SITE_RE, " ")
      .replace(PHONE_RE, " ")
      .split(/[,\t|;]/)
      .map((s) => s.replace(/\s+/g, " ").trim())
      .filter((s) => s && !/^[-+\d\s]*$/.test(s));
    for (const phone of phones) {
      if (seen.has(phone)) continue;
      seen.add(phone);
      rows.push({ company: rest[0] ?? "", name: rest[1] ?? "", phone, email, website });
    }
  }
  return rows;
}
