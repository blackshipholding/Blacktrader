"use client";
// Wechselkurse laden (EUR/USD, EUR/GBP, EUR/CHF) – auf dem Gerät zwischengespeichert, damit Euro-Beträge sofort stimmen.
import { setFxRates } from "../fx";
import { api } from "./api";

const KEY = "bt-fx-v1";
const PAIRS: [string, string][] = [
  ["USD", "EURUSD=X"],
  ["GBP", "EURGBP=X"],
  ["CHF", "EURCHF=X"],
];

// Gespeicherten Stand sofort verwenden
if (typeof window !== "undefined") {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) ?? "null") as Record<string, number> | null;
    if (c) setFxRates({ ...c, GBp: c.GBP ? c.GBP / 100 : undefined });
  } catch {
    /* ohne Speicher */
  }
}

let last = 0;
let running: Promise<void> | null = null;

/** Aktuelle Kurse laden (höchstens alle 30 Minuten). Kurs = Wert von 1 Einheit in Euro. */
export function refreshFx(force = false): Promise<void> {
  if (!force && Date.now() - last < 30 * 60e3) return running ?? Promise.resolve();
  last = Date.now();
  running = (async () => {
    const out: Record<string, number> = {};
    await Promise.all(
      PAIRS.map(async ([cur, sym]) => {
        try {
          const r = await api.candles({ kind: "stock", symbol: sym, name: sym, yahooSymbol: sym }, "1d", 30 * 60e3);
          const close = r.candles.at(-1)?.close;
          if (close && close > 0) out[cur] = 1 / close; // EURUSD = Dollar je Euro → 1 Dollar = 1/EURUSD Euro
        } catch {
          /* nächster Versuch */
        }
      }),
    );
    if (Object.keys(out).length) {
      setFxRates({ ...out, GBp: out.GBP ? out.GBP / 100 : undefined });
      try {
        localStorage.setItem(KEY, JSON.stringify(out));
      } catch {
        /* egal */
      }
    }
  })();
  return running;
}
