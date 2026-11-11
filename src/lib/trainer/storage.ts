// Speicher für den Trainer: Vercel KV / Upstash Redis über die REST-Schnittstelle.
// Ohne Zugangsdaten: Arbeitsspeicher (geht bei jedem Neustart verloren – nur zum Ausprobieren).
const mem = ((globalThis as unknown as { __trainerMem?: Map<string, string> }).__trainerMem ??= new Map());

function creds(): { url: string; token: string } | null {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}

export type StorageKind = "kv" | "memory";
export const storageKind = (): StorageKind => (creds() ? "kv" : "memory");

async function command(cmd: (string | number)[]): Promise<unknown> {
  const c = creds()!;
  const res = await fetch(c.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${c.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Speicher-Fehler ${res.status}`);
  const j = (await res.json()) as { result?: unknown; error?: string };
  if (j.error) throw new Error(`Speicher-Fehler: ${j.error}`);
  return j.result;
}

export async function getJson<T>(key: string): Promise<T | null> {
  const raw = creds() ? ((await command(["GET", key])) as string | null) : mem.get(key) ?? null;
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function setJson(key: string, value: unknown): Promise<void> {
  const raw = JSON.stringify(value);
  if (creds()) await command(["SET", key, raw]);
  else mem.set(key, raw);
}

/** Einfache Sperre gegen parallele Läufe (läuft nach `seconds` ab). */
export async function acquireLock(key: string, seconds: number): Promise<boolean> {
  if (creds()) return (await command(["SET", key, String(Date.now()), "NX", "EX", seconds])) === "OK";
  const v = mem.get(key);
  if (v && Date.now() - Number(v) < seconds * 1000) return false;
  mem.set(key, String(Date.now()));
  return true;
}

export async function releaseLock(key: string): Promise<void> {
  if (creds()) await command(["DEL", key]);
  else mem.delete(key);
}

/** Mengen (z. B. Liste der Push-Abos): Hinzufügen/Entfernen sind einzelne, atomare Befehle. */
export async function setAdd(key: string, member: string): Promise<void> {
  if (creds()) await command(["SADD", key, member]);
  else mem.set(key, JSON.stringify([...new Set([...(JSON.parse(mem.get(key) ?? "[]") as string[]), member])]));
}
export async function setRemove(key: string, member: string): Promise<void> {
  if (creds()) await command(["SREM", key, member]);
  else mem.set(key, JSON.stringify((JSON.parse(mem.get(key) ?? "[]") as string[]).filter((x) => x !== member)));
}
export async function setMembers(key: string): Promise<string[]> {
  if (creds()) return ((await command(["SMEMBERS", key])) as string[] | null) ?? [];
  return JSON.parse(mem.get(key) ?? "[]") as string[];
}
export async function delKey(key: string): Promise<void> {
  if (creds()) await command(["DEL", key]);
  else mem.delete(key);
}
