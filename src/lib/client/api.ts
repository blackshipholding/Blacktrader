"use client";
// Client-Wrapper für die eigenen API-Routen (inkl. optionaler Nutzer-Keys als Header).
import type { Candle, Fundamentals, Interval, NewsItem, Quote, ResolvedAsset } from "../types";
import { getData } from "../store/store";

function keyHeaders(): Record<string, string> {
  const k = getData().settings.keys;
  const h: Record<string, string> = {};
  if (k.finnhub) h["x-finnhub-key"] = k.finnhub;
  if (k.alphavantage) h["x-alphavantage-key"] = k.alphavantage;
  if (k.openfigi) h["x-openfigi-key"] = k.openfigi;
  return h;
}

async function get<T>(path: string, useKeys = false): Promise<T> {
  const r = await fetch(path, { headers: useKeys ? keyHeaders() : {} });
  const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j as T;
}

const qs = (o: Record<string, string | undefined>) =>
  Object.entries(o)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${encodeURIComponent(v!)}`)
    .join("&");

type Instrument = Pick<ResolvedAsset, "kind" | "binanceSymbol" | "yahooSymbol" | "coingeckoId" | "symbol" | "name">;

// Kleiner Client-Cache, damit Dashboard und Detailseite nicht doppelt laden.
const memo = new Map<string, { t: number; p: Promise<unknown> }>();
function memoized<T>(key: string, ttl: number, fn: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.t < ttl) return hit.p as Promise<T>;
  const p = fn();
  memo.set(key, { t: Date.now(), p });
  p.catch(() => memo.delete(key));
  return p;
}

export const api = {
  resolve: (q: string) => get<{ candidates: ResolvedAsset[] }>(`/api/resolve?${qs({ q })}`, true),
  candles: (a: Instrument, interval: Interval, ttl = 30e3) =>
    memoized(`c:${a.binanceSymbol}:${a.yahooSymbol}:${interval}`, ttl, () =>
      get<{ candles: Candle[]; source: string; delayed: boolean; currency?: string }>(`/api/candles?${qs({ binance: a.binanceSymbol, yahoo: a.yahooSymbol, interval })}`),
    ),
  quote: (a: Instrument) => get<Quote>(`/api/quote?${qs({ binance: a.binanceSymbol, yahoo: a.yahooSymbol })}`),
  fundamentals: (a: Instrument) =>
    memoized(`f:${a.kind}:${a.yahooSymbol}:${a.coingeckoId}`, 3600e3, () =>
      get<{ fundamentals: Fundamentals | null; note?: string }>(
        `/api/fundamentals?${qs({ kind: a.kind, symbol: a.kind === "stock" ? a.yahooSymbol : undefined, id: a.coingeckoId })}`,
        true,
      ),
    ),
  news: (a: Instrument) => {
    const name = a.name.replace(/\b(Inc\.?|Corp\.?|AG|SE|plc|N\.V\.|S\.A\.|Ltd\.?|Holdings?|Class [A-C]|ETF|UCITS)\b/gi, "").replace(/[,.]+$/, "").trim();
    const q = a.kind === "crypto" ? `${name} ${a.symbol} crypto` : a.kind === "commodity" ? `${name} Preis` : name || a.symbol;
    return memoized(`n:${q}`, 15 * 60e3, () => get<{ news: NewsItem[] }>(`/api/news?${qs({ q, yahoo: a.yahooSymbol })}`, true));
  },
  llm: async (facts: string) => {
    const k = getData().settings.keys;
    const r = await fetch("/api/llm", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-llm-key": k.llm },
      body: JSON.stringify({ provider: k.llmProvider, model: k.llmModel || undefined, facts }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
    return j.text as string;
  },
};
