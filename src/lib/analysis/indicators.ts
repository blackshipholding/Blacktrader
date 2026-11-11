// Technische Basisindikatoren. Alle Funktionen sind rein und auf Arrays definiert.
import type { Candle } from "../types";

export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** RSI nach Wilder (geglättete Durchschnittsgewinne/-verluste). */
export function rsi(closes: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  const calc = () => (avgLoss === 0 ? (avgGain === 0 ? 50 : 100) : 100 - 100 / (1 + avgGain / avgLoss));
  out[period] = calc();
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = calc();
  }
  return out;
}

/** Average True Range nach Wilder. */
export function atr(candles: Candle[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null);
  if (candles.length <= period) return out;
  const tr = candles.map((c, i) =>
    i === 0
      ? c.high - c.low
      : Math.max(c.high - c.low, Math.abs(c.high - candles[i - 1].close), Math.abs(c.low - candles[i - 1].close)),
  );
  let prev = tr.slice(1, period + 1).reduce((a, b) => a + b, 0) / period;
  out[period] = prev;
  for (let i = period + 1; i < candles.length; i++) {
    prev = (prev * (period - 1) + tr[i]) / period;
    out[i] = prev;
  }
  return out;
}

/** On-Balance-Volume. */
export function obv(candles: Candle[]): number[] {
  const out: number[] = [];
  let v = 0;
  candles.forEach((c, i) => {
    if (i > 0) {
      if (c.close > candles[i - 1].close) v += c.volume;
      else if (c.close < candles[i - 1].close) v -= c.volume;
    }
    out.push(v);
  });
  return out;
}

/** Relatives Volumen: Volumen der Kerze geteilt durch den Durchschnitt der vorherigen `period` Kerzen. */
export function relativeVolume(candles: Candle[], index = candles.length - 1, period = 20): number | null {
  if (index < period) return null;
  let sum = 0;
  for (let i = index - period; i < index; i++) sum += candles[i].volume;
  const avg = sum / period;
  if (avg <= 0) return null;
  return candles[index].volume / avg;
}

export interface VolumeProfileBin {
  low: number;
  high: number;
  volume: number;
  /** Anteil am Gesamtvolumen */
  share: number;
}

export interface VolumeProfile {
  bins: VolumeProfileBin[];
  /** Point of Control (Bin mit höchstem Volumen), Mitte */
  poc: number;
  /** Value Area (70 % des Volumens) */
  valueAreaLow: number;
  valueAreaHigh: number;
  /** Hochvolumenzonen (Bins über 1,5 × Durchschnitt) */
  highVolumeZones: { low: number; high: number }[];
}

/** Volumenprofil: Volumen jeder Kerze wird gleichmäßig auf ihre Preisspanne verteilt. */
export function volumeProfile(candles: Candle[], binCount = 24): VolumeProfile | null {
  if (candles.length === 0) return null;
  const lo = Math.min(...candles.map((c) => c.low));
  const hi = Math.max(...candles.map((c) => c.high));
  if (!(hi > lo)) return null;
  const step = (hi - lo) / binCount;
  const vols = new Array(binCount).fill(0);
  for (const c of candles) {
    const a = Math.max(0, Math.min(binCount - 1, Math.floor((c.low - lo) / step)));
    const b = Math.max(0, Math.min(binCount - 1, Math.floor((c.high - lo) / step)));
    const share = c.volume / (b - a + 1);
    for (let i = a; i <= b; i++) vols[i] += share;
  }
  const total = vols.reduce((x, y) => x + y, 0) || 1;
  const bins = vols.map((v, i) => ({ low: lo + i * step, high: lo + (i + 1) * step, volume: v, share: v / total }));
  let pocIdx = 0;
  vols.forEach((v, i) => {
    if (v > vols[pocIdx]) pocIdx = i;
  });
  // Value Area: vom POC aus nach beiden Seiten erweitern, bis 70 % erreicht sind.
  let lowIdx = pocIdx;
  let highIdx = pocIdx;
  let acc = vols[pocIdx];
  while (acc / total < 0.7 && (lowIdx > 0 || highIdx < binCount - 1)) {
    const below = lowIdx > 0 ? vols[lowIdx - 1] : -1;
    const above = highIdx < binCount - 1 ? vols[highIdx + 1] : -1;
    if (above >= below) acc += vols[++highIdx];
    else acc += vols[--lowIdx];
  }
  const avg = total / binCount;
  const zones: { low: number; high: number }[] = [];
  bins.forEach((bin) => {
    if (bin.volume > avg * 1.5) {
      const last = zones[zones.length - 1];
      if (last && Math.abs(last.high - bin.low) < step * 0.01) last.high = bin.high;
      else zones.push({ low: bin.low, high: bin.high });
    }
  });
  return {
    bins,
    poc: (bins[pocIdx].low + bins[pocIdx].high) / 2,
    valueAreaLow: bins[lowIdx].low,
    valueAreaHigh: bins[highIdx].high,
    highVolumeZones: zones,
  };
}

export type DivergenceType = "bullish" | "bearish" | "hidden-bullish" | "hidden-bearish";

export interface Divergence {
  type: DivergenceType;
  fromIndex: number;
  toIndex: number;
}

/** Lokale Extrema mit `width` Kerzen Abstand auf jeder Seite. */
function localExtrema(values: number[], width: number, kind: "max" | "min"): number[] {
  const out: number[] = [];
  for (let i = width; i < values.length - width; i++) {
    let ok = true;
    for (let j = i - width; j <= i + width && ok; j++) {
      if (j === i) continue;
      if (kind === "max" ? values[j] > values[i] : values[j] < values[i]) ok = false;
    }
    if (ok) out.push(i);
  }
  return out;
}

/**
 * RSI-Divergenzen in den letzten `lookback` Kerzen.
 * Regulär bullisch: Kurs tieferes Tief, RSI höheres Tief. Regulär bärisch: Kurs höheres Hoch, RSI tieferes Hoch.
 * Versteckt bullisch: Kurs höheres Tief, RSI tieferes Tief. Versteckt bärisch: Kurs tieferes Hoch, RSI höheres Hoch.
 */
export function rsiDivergences(candles: Candle[], rsiValues: (number | null)[], lookback = 60, width = 3): Divergence[] {
  const start = Math.max(0, candles.length - lookback);
  const lows = candles.map((c) => c.low);
  const highs = candles.map((c) => c.high);
  const out: Divergence[] = [];
  const check = (idx: number[], price: number[], kind: "min" | "max") => {
    const recent = idx.filter((i) => i >= start && rsiValues[i] != null);
    for (let k = 1; k < recent.length; k++) {
      const a = recent[k - 1];
      const b = recent[k];
      const ra = rsiValues[a] as number;
      const rb = rsiValues[b] as number;
      if (kind === "min") {
        if (price[b] < price[a] && rb > ra + 1) out.push({ type: "bullish", fromIndex: a, toIndex: b });
        else if (price[b] > price[a] && rb < ra - 1) out.push({ type: "hidden-bullish", fromIndex: a, toIndex: b });
      } else {
        if (price[b] > price[a] && rb < ra - 1) out.push({ type: "bearish", fromIndex: a, toIndex: b });
        else if (price[b] < price[a] && rb > ra + 1) out.push({ type: "hidden-bearish", fromIndex: a, toIndex: b });
      }
    }
  };
  check(localExtrema(lows, width, "min"), lows, "min");
  check(localExtrema(highs, width, "max"), highs, "max");
  return out.sort((x, y) => x.toIndex - y.toIndex);
}

/**
 * Erschöpfung am Ende einer Welle 5 an Kerze `j` (nur Daten bis `j`): neues Extrem gegenüber dem letzten
 * Hoch (Long) bzw. Tief (Short) der vorigen `look` Kerzen, aber schwächerer RSI (Divergenz).
 * `dir` = Richtung des laufenden Trades.
 */
export function exhaustionAt(candles: Candle[], rsiValues: (number | null)[], j: number, dir: 1 | -1, look = 40, gap = 5): boolean {
  if (j < look) return false;
  let pi = -1;
  for (let k = j - look; k <= j - gap; k++) {
    if (pi < 0 || (dir === 1 ? candles[k].high > candles[pi].high : candles[k].low < candles[pi].low)) pi = k;
  }
  const rNow = rsiValues[j];
  const rPrev = rsiValues[pi];
  if (pi < 0 || rNow == null || rPrev == null) return false;
  if (dir === 1) return candles[j].high >= candles[pi].high && rPrev >= 60 && rNow < rPrev - 3;
  return candles[j].low <= candles[pi].low && rPrev <= 40 && rNow > rPrev + 3;
}
