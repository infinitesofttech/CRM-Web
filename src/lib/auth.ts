import { createHash, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { jwtVerify, SignJWT } from "jose";
import { cookies } from "next/headers";
import type { Session } from "./types";

export const SESSION_COOKIE = "crm_session";
const DAYS = 7;
const isProd = process.env.NODE_ENV === "production";

function secret(): Uint8Array | null {
  const s = (process.env.AUTH_SECRET ?? "").trim() || (isProd ? "" : "local-dev-secret-change-me-please");
  return s.length >= 16 ? new TextEncoder().encode(s) : null;
}

export function adminCreds() {
  const username = (process.env.ADMIN_USERNAME ?? "").trim() || "admin";
  const password = (process.env.ADMIN_PASSWORD ?? "").trim() || (isProd ? "" : "admin123");
  return password ? { username, password } : null;
}

export function isConfigured() {
  return Boolean(adminCreds() && secret());
}

const eq = (a: string, b: string) =>
  timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());

export function hashPassword(pw: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(pw, salt, 32).toString("hex")}`;
}
export function checkPassword(pw: string, stored: string) {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const a = Buffer.from(hash, "hex");
  const b = scryptSync(pw, salt, 32);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function isAdminLogin(username: string, password: string) {
  const c = adminCreds();
  return !!c && eq(username.trim().toLowerCase(), c.username.toLowerCase()) && eq(password, c.password);
}

export async function createSession(s: Session) {
  const key = secret();
  if (!key) throw new Error("AUTH_SECRET is not configured");
  const token = await new SignJWT({ ...s })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${DAYS}d`)
    .sign(key);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    maxAge: DAYS * 86400,
  });
}

export async function destroySession() {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const key = secret();
  if (!token || !key) return null;
  try {
    const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"] });
    if (payload.role !== "admin" && payload.role !== "employee") return null;
    return {
      role: payload.role,
      name: String(payload.name ?? ""),
      employeeId: (payload.employeeId as string | null) ?? null,
    };
  } catch {
    return null;
  }
}

/** For API routes: returns the session, or a Response to send back. Also blocks cross-site writes. */
export async function requireSession(request: Request, adminOnly = false): Promise<Session | Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    const origin = request.headers.get("origin");
    if (origin && new URL(origin).host !== request.headers.get("host")) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
  }
  const s = await getSession();
  if (!s) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (adminOnly && s.role !== "admin") return Response.json({ error: "Admins only" }, { status: 403 });
  return s;
}
