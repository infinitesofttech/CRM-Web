import { promises as fs } from "fs";
import path from "path";

/**
 * Tiny key/hash store.
 *  - Production: Upstash Redis REST (KV_REST_API_URL / KV_REST_API_TOKEN, or UPSTASH_REDIS_REST_*)
 *  - Local dev:  JSON file in .data/db.json
 *  - Fallback:   in-memory (data is lost on restart - /api/health reports this)
 */
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
const isProd = process.env.NODE_ENV === "production";

export const storageMode: "redis" | "file" | "memory" = URL_ && TOKEN ? "redis" : isProd ? "memory" : "file";

type Hash = Record<string, string>;
// Shared across route/page bundles (Next bundles them separately).
const g = globalThis as unknown as { __crmMem?: Record<string, Hash> };
const mem: Record<string, Hash> = (g.__crmMem ??= {});
const FILE = path.join(process.cwd(), ".data", "db.json");

async function redis(commands: unknown[][]): Promise<unknown[]> {
  const res = await fetch(`${URL_}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Redis error ${res.status}`);
  const json = (await res.json()) as { result?: unknown; error?: string }[];
  const bad = json.find((r) => r.error);
  if (bad) throw new Error(bad.error);
  return json.map((r) => r.result);
}

async function readFile(): Promise<Record<string, Hash>> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8"));
  } catch {
    return {};
  }
}
async function writeFile(db: Record<string, Hash>) {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(db));
}

export async function getAll<T>(coll: string): Promise<T[]> {
  let h: Hash = {};
  if (storageMode === "redis") {
    const [flat] = (await redis([["HGETALL", coll]])) as [string[] | null];
    for (let i = 0; flat && i < flat.length; i += 2) h[flat[i]] = flat[i + 1];
  } else if (storageMode === "file") h = (await readFile())[coll] ?? {};
  else h = mem[coll] ?? {};
  return Object.values(h).map((v) => JSON.parse(v) as T);
}

export async function putMany<T extends { id: string }>(coll: string, items: T[]) {
  if (!items.length) return;
  if (storageMode === "redis") {
    for (let i = 0; i < items.length; i += 200) {
      const chunk = items.slice(i, i + 200);
      await redis([["HSET", coll, ...chunk.flatMap((x) => [x.id, JSON.stringify(x)])]]);
    }
  } else if (storageMode === "file") {
    const db = await readFile();
    db[coll] ??= {};
    for (const x of items) db[coll][x.id] = JSON.stringify(x);
    await writeFile(db);
  } else {
    mem[coll] ??= {};
    for (const x of items) mem[coll][x.id] = JSON.stringify(x);
  }
}

export async function getOne<T>(coll: string, id: string): Promise<T | null> {
  if (storageMode === "redis") {
    const [v] = (await redis([["HGET", coll, id]])) as [string | null];
    return v ? (JSON.parse(v) as T) : null;
  }
  const all = storageMode === "file" ? ((await readFile())[coll] ?? {}) : (mem[coll] ?? {});
  return all[id] ? (JSON.parse(all[id]) as T) : null;
}

export async function remove(coll: string, id: string) {
  if (storageMode === "redis") await redis([["HDEL", coll, id]]);
  else if (storageMode === "file") {
    const db = await readFile();
    if (db[coll]) delete db[coll][id];
    await writeFile(db);
  } else if (mem[coll]) delete mem[coll][id];
}
