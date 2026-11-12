"use client";
// EIN Euro-Live-Kurs für die ganze App (Nutzer 12.11.2026): Aktien = Euro-Kurs EINER deutschen Börse (Standard Stuttgart,
// wählbar auf der Testseite /kurstest), Krypto = Binance in Euro (z. B. ETHEUR). Rohstoffe/Indizes/Devisen und Werte ohne
// deutsche Notierung: bisheriger Kurs, in Euro umgerechnet.
// Die Analyse (Kerzen, Zonen, Signale) bleibt unverändert auf den Heimatbörsen. Damit Stops, Zonen und Einstiege (in der
// Originalwährung) weiter passen, liefern wir den Euro-Kurs als „Originalwährung-Gegenwert“ (Euro ÷ Wechselkurs) –
// in Euro angezeigt ergibt das genau den Börsenkurs.
import { useEffect, useState } from "react";
import { eurPerUnit } from "../fx";
import { api } from "./api";

export interface BourseOption { suffix: string; label: string }
export const EXCHANGES: BourseOption[] = [
  { suffix: "", label: "Aus – US-Kurs × Dollar/Euro (Standard)" },
  { suffix: ".SG", label: "Börse Stuttgart" },
  { suffix: ".F", label: "Frankfurt" },
  { suffix: ".DE", label: "Xetra" },
];
const EX_KEY = "bt-euro-exchange";
const LISTING_KEY = "bt-euro-listing-v1";
const LAST_KEY = "bt-euro-last-v1";

export function getExchange(): BourseOption {
  try {
    const s = localStorage.getItem(EX_KEY);
    return EXCHANGES.find((e) => e.suffix === s) ?? EXCHANGES[0];
  } catch {
    return EXCHANGES[0];
  }
}
export function setExchange(suffix: string): void {
  try {
    localStorage.setItem(EX_KEY, suffix);
  } catch {
    /* ohne Speicher */
  }
  cache.clear();
}

const readJson = <T,>(k: string, d: T): T => {
  try {
    return (JSON.parse(localStorage.getItem(k) ?? "null") as T) ?? d;
  } catch {
    return d;
  }
};
const writeJson = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* ohne Speicher */
  }
};

export interface AssetRef { kind: string; symbol: string; name: string; isin?: string; yahooSymbol?: string; binanceSymbol?: string }
export interface EuroQuote {
  /** Preis in Euro (so wie an der Börse) */
  eur: number;
  /** Gegenwert in der Originalwährung des Werts (für Stops/Zonen/Rechnungen) */
  native: number;
  source: string;
  /** Unix-Sekunden des letzten Kurses */
  time?: number;
}

const isEurSymbol = (s: string) => /\.(DE|F|SG|BE|DU|MU|HM|VI|PA|AS|MI|MC|BR|LS|HE|IR)$/i.test(s);

/** Deutsche Notierung eines US-Werts an der gewählten Börse (z. B. Apple an Stuttgart = APC.SG) */
async function findListing(a: AssetRef, suffix: string): Promise<string | null> {
  const key = `${suffix}|${a.symbol}`;
  const map = readJson<Record<string, string>>(LISTING_KEY, {});
  if (map[key] != null) return map[key] || null;
  let found = "";
  const re = new RegExp(`\\${suffix}$`, "i");
  for (const q of [a.isin, a.name].filter(Boolean) as string[]) {
    try {
      const r = await api.resolve(q);
      const c = r.candidates.find((x) => x.kind === "stock" && re.test(x.yahooSymbol ?? x.symbol));
      if (c) {
        found = c.yahooSymbol ?? c.symbol;
        break;
      }
    } catch {
      /* nächster Versuch */
    }
  }
  writeJson(LISTING_KEY, { ...readJson<Record<string, string>>(LISTING_KEY, {}), [key]: found });
  return found || null;
}

const cache = new Map<string, { at: number; v: EuroQuote | null }>();
const pending = new Map<string, Promise<EuroQuote | null>>();

/** Letzter bekannter Euro-Kurs (bleibt stehen, wenn die Börse geschlossen ist oder keine Verbindung besteht) */
export function lastEuroQuote(a: Pick<AssetRef, "kind" | "symbol">): EuroQuote | null {
  return readJson<Record<string, EuroQuote>>(LAST_KEY, {})[`${a.kind}:${a.symbol}`] ?? null;
}
function remember(a: AssetRef, v: EuroQuote) {
  writeJson(LAST_KEY, { ...readJson<Record<string, EuroQuote>>(LAST_KEY, {}), [`${a.kind}:${a.symbol}`]: v });
}

/**
 * Euro-Live-Kurs eines Werts. `nativeCurrency` = Währung der Heimatbörse (USD, USDT …).
 * null = kein Euro-Kurs verfügbar → der Aufrufer nimmt den bisherigen Kurs (umgerechnet).
 */
export function euroQuote(a: AssetRef, nativeCurrency?: string, maxAgeMs = 20e3): Promise<EuroQuote | null> {
  const ex = getExchange();
  const key = `${a.kind}:${a.symbol}|${ex.suffix}`;
  const c = cache.get(key);
  if (c && Date.now() - c.at < maxAgeMs) return Promise.resolve(c.v);
  const p0 = pending.get(key);
  if (p0) return p0;
  const p = (async (): Promise<EuroQuote | null> => {
    const fx = eurPerUnit(nativeCurrency ?? (a.kind === "crypto" ? "USDT" : "USD"));
    let out: EuroQuote | null = null;
    try {
      if (a.kind === "crypto" && a.binanceSymbol && /USDT$/i.test(a.binanceSymbol)) {
        const pair = a.binanceSymbol.replace(/USDT$/i, "EUR");
        const q = await api.quote({ binanceSymbol: pair } as never);
        if (q.price > 0 && fx) out = { eur: q.price, native: q.price / fx, source: "Binance EUR", time: q.time };
      } else if (ex.suffix && a.kind === "stock" && nativeCurrency && nativeCurrency !== "EUR" && !isEurSymbol(a.yahooSymbol ?? a.symbol) && !/[=^]/.test(a.yahooSymbol ?? a.symbol)) {
        const sym = await findListing(a, ex.suffix);
        if (sym) {
          const q = await api.quote({ kind: "stock", symbol: sym, name: sym, yahooSymbol: sym } as never);
          if (q.price > 0 && (q.currency ?? "EUR") === "EUR" && fx) out = { eur: q.price, native: q.price / fx, source: ex.label, time: q.time };
        }
      }
    } catch {
      out = null;
    }
    if (out) remember(a, out);
    cache.set(key, { at: Date.now(), v: out });
    return out;
  })().finally(() => pending.delete(key));
  pending.set(key, p);
  return p;
}

/** Binance-Strom (Euro-Paar) eines Krypto-Werts, z. B. ETHUSDT → ETHEUR; null, wenn kein USDT-Paar */
export const binanceEurPair = (binanceSymbol?: string): string | null => (binanceSymbol && /USDT$/i.test(binanceSymbol) ? binanceSymbol.replace(/USDT$/i, "EUR") : null);

/** Euro-Live-Kurs für eine Kachel ohne eigenen Live-Kurs (z. B. Chancen). undefined = noch keiner / nicht verfügbar */
export function useEuroNative(a: AssetRef, nativeCurrency: string | undefined, enabled: boolean): number | undefined {
  const [v, setV] = useState<number | undefined>(() => (enabled ? lastEuroQuote(a)?.native : undefined));
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = () => void euroQuote(a, nativeCurrency, 55e3).then((q) => alive && q && setV(q.native));
    load();
    const t = setInterval(load, 60e3);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [enabled, a.kind, a.symbol, nativeCurrency]); // eslint-disable-line react-hooks/exhaustive-deps
  return v;
}

/** Nur für die Testseite: Euro-Kurs eines Werts an EINER bestimmten Börse (ohne Zwischenspeicher, ohne Auswahl) */
export async function probeExchange(a: AssetRef, suffix: string): Promise<{ symbol: string; price: number; time?: number } | null> {
  try {
    const sym = await findListing(a, suffix);
    if (!sym) return null;
    const q = await api.quote({ kind: "stock", symbol: sym, name: sym, yahooSymbol: sym } as never);
    return q.price > 0 && (q.currency ?? "EUR") === "EUR" ? { symbol: sym, price: q.price, time: q.time } : null;
  } catch {
    return null;
  }
}
export async function probeBinanceEur(binanceSymbol?: string): Promise<{ price: number; time?: number } | null> {
  const pair = binanceEurPair(binanceSymbol);
  if (!pair) return null;
  try {
    const q = await api.quote({ binanceSymbol: pair } as never);
    return q.price > 0 ? { price: q.price, time: q.time } : null;
  } catch {
    return null;
  }
}

/** Nur für die Testseite: Kurs der tokenisierten Aktie bei Kraken (USD), null = nicht verfügbar */
export async function probeXStock(symbol: string): Promise<{ price: number; time?: number } | null> {
  try {
    const res = await fetch(`/api/xstock?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" });
    if (!res.ok) return null;
    const j = (await res.json()) as { price?: number; time?: number };
    return j.price && j.price > 0 ? { price: j.price, time: j.time } : null;
  } catch {
    return null;
  }
}
