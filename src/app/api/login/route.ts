import { checkPassword, createSession, isAdminLogin, isConfigured } from "@/lib/auth";
import { getAll } from "@/lib/store";
import type { Employee } from "@/lib/types";

export async function POST(request: Request) {
  if (!isConfigured()) return Response.json({ error: "Server not configured (ADMIN_PASSWORD / AUTH_SECRET)" }, { status: 503 });
  const body = (await request.json().catch(() => ({}))) as { username?: string; password?: string };
  const username = String(body.username ?? "").trim();
  const password = String(body.password ?? "");
  if (!username || !password) return Response.json({ error: "Enter username and password" }, { status: 400 });

  if (isAdminLogin(username, password)) {
    await createSession({ role: "admin", name: "Admin", employeeId: null });
    return Response.json({ ok: true });
  }
  const emp = (await getAll<Employee>("employees")).find((e) => e.username.toLowerCase() === username.toLowerCase());
  if (emp && checkPassword(password, emp.passwordHash)) {
    await createSession({ role: "employee", name: emp.name, employeeId: emp.id });
    return Response.json({ ok: true });
  }
  await new Promise((r) => setTimeout(r, 600));
  return Response.json({ error: "Wrong username or password" }, { status: 401 });
}
