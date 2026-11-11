// Server-seitige Fetch-Helfer: TTL-Cache, Deduplizierung paralleler Anfragen und Drosselung je Upstream-Host.
import "server-only";

type Entry = { value: unknown; expires: number };
const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();
const MAX_ENTRIES = 2000;

export const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

export class UpstreamError extends Error {
  constructor(
    message: string,
    public status = 502,
  ) {
    super(message);
  }
}

/** Liefert gecachten Wert oder berechnet ihn genau einmal (auch bei parallelen Aufrufen). */
export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;
  const running = inflight.get(key);
  if (running) return running as Promise<T>;
  const p = (async () => {
    try {
      const value = await fn();
      if (cache.size > MAX_ENTRIES) {
        const now = Date.now();
        for (const [k, v] of cache) if (v.expires < now || cache.size > MAX_ENTRIES * 0.8) cache.delete(k);
      }
      cache.set(key, { value, expires: Date.now() + ttlMs });
      return value;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

/** Abgelaufenen Cache-Wert holen (Fallback, wenn Upstream ausfällt). */
export function stale<T>(key: string): T | undefined {
  return cache.get(key)?.value as T | undefined;
}

// --- Drosselung: Mindestabstand zwischen Anfragen je Host
const HOST_MIN_INTERVAL: Record<string, number> = {
  "api.coingecko.com": 2500,
  "api.openfigi.com": 2500,
  "www.alphavantage.co": 12500,
  "finnhub.io": 1100,
};
const nextSlot = new Map<string, number>();

async function throttle(host: string) {
  const gap = HOST_MIN_INTERVAL[host] ?? 120;
  const now = Date.now();
  const slot = Math.max(now, nextSlot.get(host) ?? 0);
  nextSlot.set(host, slot + gap);
  const wait = slot - now;
  if (wait > 15000) throw new UpstreamError(`Rate-Limit für ${host} – bitte kurz warten.`, 429);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

export interface FetchOpts {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

export async function fetchRaw(url: string, opts: FetchOpts = {}): Promise<Response> {
  const host = new URL(url).host;
  await throttle(host);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 10000);
  try {
    return await fetch(url, {
      method: opts.method ?? "GET",
      headers: { "User-Agent": UA, Accept: "application/json, text/xml, */*", ...opts.headers },
      body: opts.body,
      signal: ctrl.signal,
      cache: "no-store",
    });
  } catch (e) {
    throw new UpstreamError(`${host} nicht erreichbar (${(e as Error).name === "AbortError" ? "Timeout" : (e as Error).message})`);
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJson<T = unknown>(url: string, opts: FetchOpts = {}): Promise<T> {
  const res = await fetchRaw(url, opts);
  if (!res.ok) {
    const host = new URL(url).host;
    throw new UpstreamError(`${host} antwortete mit HTTP ${res.status}`, res.status === 429 ? 429 : 502);
  }
  return (await res.json()) as T;
}

export async function fetchText(url: string, opts: FetchOpts = {}): Promise<string> {
  const res = await fetchRaw(url, opts);
  if (!res.ok) throw new UpstreamError(`${new URL(url).host} antwortete mit HTTP ${res.status}`);
  return res.text();
}
