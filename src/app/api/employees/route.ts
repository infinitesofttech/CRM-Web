import { randomUUID } from "crypto";
import { hashPassword, requireSession } from "@/lib/auth";
import { now } from "@/lib/contacts";
import { getAll, putMany } from "@/lib/store";
import type { Employee, PublicEmployee } from "@/lib/types";

const strip = ({ passwordHash: _h, ...rest }: Employee): PublicEmployee => rest;

export async function GET(request: Request) {
  const s = await requireSession(request);
  if (s instanceof Response) return s;
  const all = (await getAll<Employee>("employees")).sort((a, b) => a.name.localeCompare(b.name));
  return Response.json({ employees: all.map(strip) });
}

export async function POST(request: Request) {
  const s = await requireSession(request, true);
  if (s instanceof Response) return s;
  const b = (await request.json().catch(() => ({}))) as { name?: string; username?: string; password?: string };
  const name = (b.name ?? "").trim();
  const username = (b.username ?? "").trim().toLowerCase();
  const password = b.password ?? "";
  if (!name || !/^[a-z0-9._-]{3,30}$/.test(username) || password.length < 6) {
    return Response.json({ error: "Name, username (3-30 chars, a-z 0-9 . _ -) and password (6+) are required" }, { status: 400 });
  }
  const all = await getAll<Employee>("employees");
  if (all.some((e) => e.username === username)) return Response.json({ error: "Username already taken" }, { status: 409 });
  const emp: Employee = { id: randomUUID(), name, username, passwordHash: hashPassword(password), createdAt: now() };
  await putMany("employees", [emp]);
  return Response.json({ employee: strip(emp) });
}
