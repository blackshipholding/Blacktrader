// Anzeige in Tageskerzen: Wellenpunkte aus einer gröberen Zählung (z. B. Wochenkerzen) auf die passende Tageskerze legen –
// die Tageskerze innerhalb der Wochenkerze, deren Hoch (bzw. Tief) dem Wellenpunkt am nächsten kommt. Preise bleiben gleich.
import type { WaveCount } from "./elliott";
import type { Candle } from "../types";

/** Erste Kerze mit Zeit ≥ t (sonst Länge) */
function lowerBound(c: Candle[], t: number): number {
  let lo = 0;
  let hi = c.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (c[m].time < t) lo = m + 1;
    else hi = m;
  }
  return lo;
}

/** Zeit des Wellenpunkts in den feineren Kerzen. `span` = Länge der groben Kerze in Sekunden. */
export function snapTime(time: number, price: number, type: "H" | "L", fine: Candle[], span: number): number {
  if (!fine.length) return time;
  const a = lowerBound(fine, time - 2 * 86400);
  const b = lowerBound(fine, time + span + 86400);
  let best = -1;
  let diff = Infinity;
  for (let i = a; i < b && i < fine.length; i++) {
    const d = Math.abs((type === "H" ? fine[i].high : fine[i].low) - price);
    if (d < diff) (diff = d), (best = i);
  }
  if (best >= 0) return fine[best].time;
  // Außerhalb der feinen Kerzen: nächstgelegene Kerze
  const i = Math.min(fine.length - 1, lowerBound(fine, time));
  return fine[i].time;
}

/** Zählung mit Zeiten passend zu den Tageskerzen (Tageskerzen selbst → unverändert; Wochen- oder Stundenzählung → passende Tageskerze). */
export function snapCount<T extends WaveCount | undefined | null>(count: T, fine: Candle[], span: number): T {
  if (!count || !fine.length || span === 86400) return count;
  const pivots = count.pivots.map((p) => ({ ...p, time: snapTime(p.time, p.price, p.type, fine, span) }));
  return { ...count, pivots } as T;
}

/** Sekunden je Kerze */
export const INTERVAL_SECONDS: Record<string, number> = { "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400, "1w": 7 * 86400, "1M": 31 * 86400 };
