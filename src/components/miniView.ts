// Mini-Charts (Chancen, Watchlist, Depot-Ansicht): immer Tageskerzen. Gerechnet wird weiter auf Tag + Woche –
// Wellenpunkte und der blaue Bereich aus Wochenkerzen werden auf die passende Tageskerze gelegt.
import type { WaveCount } from "@/lib/analysis/elliott";
import { INTERVAL_SECONDS, snapCount, snapTime } from "@/lib/analysis/snapPivots";
import type { ScanEntry } from "@/lib/client/scanner";
import { HORIZON_DEFAULT_INTERVAL, type Candle, type Horizon } from "@/lib/types";
import type { MiniLongTerm } from "./MiniChart";

export interface MiniView {
  candles: Candle[];
  best?: WaveCount;
  longterm: MiniLongTerm | null;
  /** Chart beginnt hier (erster Wellenpunkt), damit die ganze Zählung sichtbar ist */
  from?: number;
}

const spanOf = (h?: Horizon) => INTERVAL_SECONDS[HORIZON_DEFAULT_INTERVAL[h ?? "medium"]] ?? 86400;

export function miniView(entry: ScanEntry, count: WaveCount | undefined, countHorizon: Horizon | undefined, fallback: Candle[]): MiniView {
  const daily = entry.daily?.length ? entry.daily : null;
  const b = entry.best;
  const lt0 = b.color === "blau" ? b.lt ?? null : null;
  if (!daily) {
    // Ohne Tageskerzen (selten): wie bisher
    return { candles: fallback, best: count, longterm: lt0 ? { start: lt0.start, high: lt0.high, zoneTop: lt0.zoneTop, zoneBottom: lt0.zoneBottom, invalidation: lt0.invalidation, target: lt0.targets[0] } : null };
  }
  const best = snapCount(count, daily, spanOf(countHorizon));
  let longterm: MiniLongTerm | null = null;
  if (lt0) {
    const span = spanOf(entry.ltHorizon ?? "long");
    longterm = {
      start: { time: snapTime(lt0.start.time, lt0.start.price, "L", daily, span), price: lt0.start.price },
      high: { time: snapTime(lt0.high.time, lt0.high.price, "H", daily, span), price: lt0.high.price },
      zoneTop: lt0.zoneTop,
      zoneBottom: lt0.zoneBottom,
      invalidation: lt0.invalidation,
      target: lt0.targets[0],
    };
  }
  const first = longterm ? longterm.start.time : best?.pivots[0]?.time;
  return { candles: daily, best, longterm, from: first };
}
