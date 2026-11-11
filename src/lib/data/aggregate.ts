import type { Candle } from "../types";

/** Fasst Kerzen zu größeren Zeitblöcken zusammen (z. B. 1h → 4h). Blöcke werden an UTC ausgerichtet. */
export function aggregateCandles(candles: Candle[], seconds: number): Candle[] {
  const out: Candle[] = [];
  for (const c of candles) {
    const bucket = Math.floor(c.time / seconds) * seconds;
    const last = out[out.length - 1];
    if (last && last.time === bucket) {
      last.high = Math.max(last.high, c.high);
      last.low = Math.min(last.low, c.low);
      last.close = c.close;
      last.volume += c.volume;
    } else out.push({ ...c, time: bucket });
  }
  return out;
}
