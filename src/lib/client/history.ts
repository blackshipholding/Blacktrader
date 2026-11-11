"use client";
// Lädt lange Kurshistorien für das EchoChart und prüft vorher, was die kostenlosen Quellen hergeben.
import type { Candle, Interval, ResolvedAsset } from "../types";

export const INTERVAL_SECONDS: Record<Interval, number> = { "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400, "1w": 604800, "1M": 2592000 };

/** Yahoo liefert 5-/15-Minuten-Kerzen nur ~60 Tage, Stundenkerzen ~2 Jahre. */
export const YAHOO_MAX_DAYS: Record<Interval, number> = { "5m": 59, "15m": 59, "1h": 729, "4h": 729, "1d": 36500, "1w": 36500, "1M": 36500 };

/** Obergrenze, damit Laden und Rechnen auf dem Handy im Rahmen bleiben. */
export const MAX_CANDLES = 120_000;

/** Ersatzquellen mit langer Historie bei Binance (folgen dem Preis des Basiswerts). */
const BINANCE_PROXY: Record<string, { symbol: string; note: string }> = {
  "GC=F": { symbol: "PAXGUSDT", note: "Gold über den Gold-Token PAXG (Binance) – folgt dem Goldpreis, auch am Wochenende gehandelt." },
};

export const LOOKBACKS = [
  { days: 7, label: "1 Woche" },
  { days: 30, label: "1 Monat" },
  { days: 90, label: "3 Monate" },
  { days: 180, label: "6 Monate" },
  { days: 365, label: "1 Jahr" },
  { days: 730, label: "2 Jahre" },
  { days: 1825, label: "5 Jahre" },
  { days: 3650, label: "10 Jahre" },
];

export interface HistoryPlan {
  ok: boolean;
  source: "binance" | "yahoo";
  symbol: string;
  note?: string;
  reason?: string;
  candlesEstimate: number;
}

/** Welche Quelle wird genutzt und ist der gewünschte Zeitraum überhaupt möglich? */
export function planHistory(asset: Pick<ResolvedAsset, "binanceSymbol" | "yahooSymbol" | "kind">, interval: Interval, days: number): HistoryPlan {
  const candlesEstimate = Math.round((days * 86400) / INTERVAL_SECONDS[interval]);
  const tooMany = candlesEstimate > MAX_CANDLES;
  if (asset.binanceSymbol) {
    return tooMany
      ? { ok: false, source: "binance", symbol: asset.binanceSymbol, candlesEstimate, reason: `Zu viele Kerzen (${candlesEstimate.toLocaleString("de-DE")}) – bitte kürzeren Zeitraum oder größere Kerzen wählen.` }
      : { ok: true, source: "binance", symbol: asset.binanceSymbol, candlesEstimate };
  }
  const y = asset.yahooSymbol ?? "";
  if (days <= YAHOO_MAX_DAYS[interval]) return { ok: true, source: "yahoo", symbol: y, candlesEstimate };
  const proxy = BINANCE_PROXY[y];
  if (proxy && !tooMany) return { ok: true, source: "binance", symbol: proxy.symbol, note: proxy.note, candlesEstimate };
  const max = YAHOO_MAX_DAYS[interval];
  return {
    ok: false,
    source: "yahoo",
    symbol: y,
    candlesEstimate,
    reason: `Die kostenlose Quelle (Yahoo) liefert ${interval}-Kerzen nur für die letzten ${max >= 700 ? "2 Jahre" : "60 Tage"}. Für längere Zeiträume größere Kerzen wählen.`,
  };
}

async function getJson<T>(url: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(url);
    const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
    if (r.ok) return j as T;
    if (r.status === 429 && attempt < 5) {
      await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
      continue;
    }
    throw new Error(j.error ?? `HTTP ${r.status}`);
  }
}

/** Lädt die Kerzen (Binance seitenweise, Yahoo in einem Abruf). */
export async function loadHistory(plan: HistoryPlan, interval: Interval, days: number, onProgress?: (p: number) => void): Promise<Candle[]> {
  if (plan.source === "yahoo") {
    onProgress?.(0.1);
    const r = await getJson<{ candles: Candle[] }>(`/api/history?yahoo=${encodeURIComponent(plan.symbol)}&interval=${interval}&days=${days}`);
    onProgress?.(1);
    return r.candles;
  }
  const stepMs = INTERVAL_SECONDS[interval] * 1000;
  const end = Date.now();
  let start = end - days * 86400e3;
  const total = end - start;
  const all: Candle[] = [];
  while (start < end) {
    const r = await getJson<{ candles: Candle[] }>(`/api/history?binance=${encodeURIComponent(plan.symbol)}&interval=${interval}&start=${Math.floor(start)}`);
    if (r.candles.length === 0) {
      // Vor dem Handelsstart keine Daten: zum nächsten Block springen
      start += stepMs * 1000;
      continue;
    }
    const before = all.length;
    for (const c of r.candles) if (!all.length || c.time > all[all.length - 1].time) all.push(c);
    if (all.length === before) break; // keine neueren Kerzen – fertig (Schutz vor Endlosschleife)
    start = all[all.length - 1].time * 1000 + stepMs;
    onProgress?.(Math.min(1, 1 - (end - start) / total));
    if (r.candles.length < 1000) break;
  }
  onProgress?.(1);
  return all;
}
