/** Normalise an Indian mobile number to "+91 XXXXX XXXXX". Returns "" when it is not a valid mobile. */
export function normalizePhone(raw: string): string {
  let d = (raw || "").replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (!/^[6-9]\d{9}$/.test(d)) return "";
  return `+91 ${d.slice(0, 5)} ${d.slice(5)}`;
}

export function phoneDigits(p: string): string {
  return normalizePhone(p).replace(/\D/g, "");
}
