// Einfacher Token-Bucket je Client-IP für die eigenen API-Routen (Schutz vor Endlosschleifen/Missbrauch).
import "server-only";

const buckets = new Map<string, { tokens: number; updated: number }>();
const CAPACITY = 180; // Anfragen
const REFILL_PER_SEC = 3;

export function checkRateLimit(req: Request): boolean {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
  const now = Date.now();
  const b = buckets.get(ip) ?? { tokens: CAPACITY, updated: now };
  b.tokens = Math.min(CAPACITY, b.tokens + ((now - b.updated) / 1000) * REFILL_PER_SEC);
  b.updated = now;
  if (b.tokens < 1) {
    buckets.set(ip, b);
    return false;
  }
  b.tokens -= 1;
  buckets.set(ip, b);
  if (buckets.size > 5000) for (const [k, v] of buckets) if (now - v.updated > 600000) buckets.delete(k);
  return true;
}
