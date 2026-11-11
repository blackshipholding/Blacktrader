// Binance Public API (ohne Key). data-api.binance.vision ist der reine Marktdaten-Endpunkt.
import "server-only";
import type { Candle, Interval, Quote } from "../types";
import { cached, fetchJson, UpstreamError } from "./http";

const BASES = ["https://data-api.binance.vision", "https://api.binance.com", "https://api1.binance.com"];

async function get<T>(path: string): Promise<T> {
  let lastErr: unknown;
  for (const base of BASES) {
    try {
      return await fetchJson<T>(`${base}${path}`, { timeoutMs: 7000 });
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new UpstreamError("Binance nicht erreichbar");
}

type Kline = [number, string, string, string, string, string, number, ...unknown[]];

export async function binanceCandles(symbol: string, iv: Interval): Promise<Candle[]> {
  const ttl = iv === "5m" ? 20e3 : iv === "15m" ? 45e3 : iv === "1h" ? 90e3 : iv === "4h" ? 180e3 : 600e3;
  return cached(`bc:${symbol}:${iv}`, ttl, async () => {
    const rows = await get<Kline[]>(`/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${iv}&limit=1000`);
    return rows.map((k) => ({ time: Math.floor(k[0] / 1000), open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] }));
  });
}

/** Eine Seite (bis 1000 Kerzen) ab `startMs` – für lange Historien seitenweise abrufen. */
export async function binanceCandlesFrom(symbol: string, iv: Interval, startMs: number): Promise<Candle[]> {
  const closedPage = startMs + 1000 * intervalMs(iv) < Date.now();
  return cached(`bp:${symbol}:${iv}:${startMs}`, closedPage ? 24 * 3600e3 : 60e3, async () => {
    const rows = await get<Kline[]>(`/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${iv}&startTime=${startMs}&limit=1000`);
    return rows.map((k) => ({ time: Math.floor(k[0] / 1000), open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] }));
  });
}

export function intervalMs(iv: Interval): number {
  return { "5m": 300e3, "15m": 900e3, "1h": 3600e3, "4h": 4 * 3600e3, "1d": 86400e3, "1w": 7 * 86400e3, "1M": 30 * 86400e3 }[iv];
}

export async function binanceQuote(symbol: string): Promise<Quote> {
  return cached(`bq:${symbol}`, 5e3, async () => {
    const t = await get<{ lastPrice: string; priceChangePercent: string; closeTime: number }>(`/api/v3/ticker/24hr?symbol=${encodeURIComponent(symbol)}`);
    return {
      symbol,
      price: +t.lastPrice,
      changePct: +t.priceChangePercent,
      currency: symbol.endsWith("USDT") ? "USDT" : symbol.endsWith("EUR") ? "EUR" : undefined,
      time: Math.floor(t.closeTime / 1000),
      delayed: false,
      source: "Binance",
    };
  });
}

/** Prüft, ob ein Handelspaar existiert. null = Binance nicht erreichbar (unbekannt). */
export async function binanceHasSymbol(symbol: string): Promise<boolean | null> {
  try {
    return await cached(`bx:${symbol}`, 24 * 3600e3, async () => {
      try {
        const r = await get<{ symbols?: { symbol: string; status: string }[] }>(`/api/v3/exchangeInfo?symbol=${encodeURIComponent(symbol)}`);
        return !!r.symbols?.some((s) => s.symbol === symbol && s.status === "TRADING");
      } catch (e) {
        if (e instanceof UpstreamError && /HTTP 400/.test(e.message)) return false;
        throw e;
      }
    });
  } catch {
    return null;
  }
}
