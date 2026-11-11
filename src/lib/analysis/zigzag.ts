// ZigZag-Swing-Erkennung mit ATR-basierter Umkehrschwelle.
import type { Candle } from "../types";
import { atr } from "./indicators";

export interface Pivot {
  index: number;
  time: number;
  price: number;
  type: "H" | "L";
  /** false = letztes, noch nicht durch Gegenbewegung bestätigtes Extrem */
  confirmed: boolean;
}

/**
 * Ein Swing wird gezählt, sobald der Kurs sich um `atrMult × ATR` vom letzten Extrem entfernt.
 * Der ATR wird je Kerze verwendet (adaptive Schwelle); vor dem ATR-Start gilt der erste verfügbare Wert.
 */
export function zigzag(candles: Candle[], atrMult = 2, atrPeriod = 14): Pivot[] {
  if (candles.length < 3) return [];
  const atrs = atr(candles, Math.min(atrPeriod, Math.max(2, candles.length - 2)));
  const firstAtr = atrs.find((v) => v != null) ?? candles[0].high - candles[0].low;
  const thr = (i: number) => (atrs[i] ?? firstAtr) * atrMult;

  const pivots: Pivot[] = [];
  let dir: 0 | 1 | -1 = 0;
  let hiIdx = 0;
  let loIdx = 0;

  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    if (dir === 0) {
      if (c.high > candles[hiIdx].high) hiIdx = i;
      if (c.low < candles[loIdx].low) loIdx = i;
      if (candles[hiIdx].high - candles[loIdx].low >= thr(i)) {
        if (hiIdx > loIdx) {
          pivots.push(mk(candles, loIdx, "L"));
          dir = 1;
        } else {
          pivots.push(mk(candles, hiIdx, "H"));
          dir = -1;
        }
      }
      continue;
    }
    if (dir === 1) {
      if (c.high >= candles[hiIdx].high) hiIdx = i;
      else if (candles[hiIdx].high - c.low >= thr(i)) {
        pivots.push(mk(candles, hiIdx, "H"));
        dir = -1;
        loIdx = i;
        for (let j = hiIdx + 1; j <= i; j++) if (candles[j].low < candles[loIdx].low) loIdx = j;
      }
    } else {
      if (c.low <= candles[loIdx].low) loIdx = i;
      else if (c.high - candles[loIdx].low >= thr(i)) {
        pivots.push(mk(candles, loIdx, "L"));
        dir = 1;
        hiIdx = i;
        for (let j = loIdx + 1; j <= i; j++) if (candles[j].high > candles[hiIdx].high) hiIdx = j;
      }
    }
  }
  // Letztes laufendes Extrem als unbestätigter Pivot.
  if (dir === 1) pivots.push({ ...mk(candles, hiIdx, "H"), confirmed: false });
  else if (dir === -1) pivots.push({ ...mk(candles, loIdx, "L"), confirmed: false });
  return pivots;
}

function mk(candles: Candle[], index: number, type: "H" | "L"): Pivot {
  const c = candles[index];
  return { index, time: c.time, price: type === "H" ? c.high : c.low, type, confirmed: true };
}

/** Konstruiert Pivots direkt aus einer Preisfolge (für Tests und Muster-Prüfung). */
export function pivotsFromPrices(prices: number[], startType?: "H" | "L"): Pivot[] {
  const first: "H" | "L" = startType ?? (prices[1] > prices[0] ? "L" : "H");
  return prices.map((price, i) => ({
    index: i,
    time: i,
    price,
    type: i % 2 === 0 ? first : first === "L" ? "H" : "L",
    confirmed: true,
  }));
}
