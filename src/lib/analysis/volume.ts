// Modul C: Volumen & RSI → Score 0 … 100 (50 = neutral, > 50 bullisch).
import type { Candle } from "../types";
import type { WaveCount } from "./elliott";
import { obv, relativeVolume, rsi, rsiDivergences, volumeProfile, type Divergence, type VolumeProfile } from "./indicators";

export interface VolumeRsiResult {
  score: number;
  rsi: number | null;
  rsiState: "überkauft" | "überverkauft" | "neutral";
  divergences: Divergence[];
  relVolume: number | null;
  obvTrend: 1 | -1 | 0;
  breakout: "up" | "down" | null;
  waveVolumeConfirmed: boolean | null;
  profile: VolumeProfile | null;
  findings: string[];
  hasVolume: boolean;
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** Steigung per linearer Regression (normiert auf den Mittelwert). */
function slope(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const mx = (n - 1) / 2;
  const my = values.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  values.forEach((v, i) => {
    num += (i - mx) * (v - my);
    den += (i - mx) ** 2;
  });
  return den ? num / den : 0;
}

/** RSI-Beitrag: Momentum im Bereich 30–70, Umkehrpotenzial in den Extremzonen. */
export interface VolumeRsiOptions {
  rsiOverbought: number;
  rsiOversold: number;
  divergenceRecentBars: number;
  relVolHigh: number;
  relVolBreakout: number;
  relVolLow: number;
}

export const DEFAULT_VOLUME_OPTIONS: VolumeRsiOptions = { rsiOverbought: 70, rsiOversold: 30, divergenceRecentBars: 20, relVolHigh: 1.5, relVolBreakout: 1.3, relVolLow: 0.6 };

export function rsiContribution(r: number, ob = 70, os = 30): number {
  if (ob !== 70 || os !== 30) {
    if (r > ob) return 0.4 - (r - ob) / 15;
    if (r < os) return -0.4 + (os - r) / 15;
    return 0.4 * ((2 * (r - os)) / (ob - os) - 1);
  }
  if (r > 70) return 0.4 - (r - 70) / 15;
  if (r < 30) return -0.4 + (30 - r) / 15;
  return (r - 50) / 50;
}

function avgVolume(candles: Candle[], from: number, to: number): number {
  let s = 0;
  let n = 0;
  for (let i = Math.max(0, from); i <= Math.min(candles.length - 1, to); i++) {
    s += candles[i].volume;
    n++;
  }
  return n ? s / n : 0;
}

export function analyzeVolumeRsi(candles: Candle[], count?: WaveCount, vo: VolumeRsiOptions = DEFAULT_VOLUME_OPTIONS): VolumeRsiResult {
  const closes = candles.map((c) => c.close);
  const r = rsi(closes, 14);
  const last = r[r.length - 1] ?? null;
  const hasVolume = candles.some((c) => c.volume > 0);
  const findings: string[] = [];
  let sum = 0;

  let rsiState: VolumeRsiResult["rsiState"] = "neutral";
  if (last != null) {
    sum += rsiContribution(last, vo.rsiOverbought, vo.rsiOversold);
    if (last > vo.rsiOverbought) rsiState = "überkauft";
    else if (last < vo.rsiOversold) rsiState = "überverkauft";
    findings.push(`RSI(14) bei ${last.toFixed(1)} – ${rsiState === "neutral" ? (last >= 50 ? "positives Momentum" : "schwaches Momentum") : rsiState}.`);
  }

  const divs = rsiDivergences(candles, r, 60).filter((d) => d.toIndex >= candles.length - vo.divergenceRecentBars);
  const weights = { bullish: 0.6, bearish: -0.6, "hidden-bullish": 0.3, "hidden-bearish": -0.3 } as const;
  const names = { bullish: "bullische", bearish: "bärische", "hidden-bullish": "versteckte bullische", "hidden-bearish": "versteckte bärische" };
  const latestDiv = divs[divs.length - 1];
  if (latestDiv) {
    sum += weights[latestDiv.type];
    findings.push(`Frische ${names[latestDiv.type]} RSI-Divergenz.`);
  }

  let relVol: number | null = null;
  let obvTrend: 1 | -1 | 0 = 0;
  let breakout: "up" | "down" | null = null;
  let waveVolumeConfirmed: boolean | null = null;
  let profile: VolumeProfile | null = null;

  if (hasVolume && candles.length > 25) {
    const lastC = candles[candles.length - 1];
    relVol = relativeVolume(candles);
    if (relVol != null) {
      const up = lastC.close >= lastC.open;
      if (relVol > vo.relVolHigh) {
        sum += up ? 0.3 : -0.3;
        findings.push(`Relatives Volumen ${relVol.toFixed(2)}× – ${up ? "Käufer" : "Verkäufer"} zeigen Präsenz.`);
      } else if (relVol < vo.relVolLow) findings.push(`Dünnes Volumen (${relVol.toFixed(2)}×) – Bewegung ohne Überzeugung.`);
    }
    const o = obv(candles).slice(-20);
    const so = slope(o);
    const sp = slope(closes.slice(-20));
    const avgVol = avgVolume(candles, candles.length - 20, candles.length - 1) || 1;
    if (Math.abs(so) > avgVol * 0.05) {
      obvTrend = so > 0 ? 1 : -1;
      sum += obvTrend * 0.25;
      if (Math.sign(so) !== Math.sign(sp) && sp !== 0) findings.push(`OBV läuft ${obvTrend > 0 ? "aufwärts" : "abwärts"} gegen den Kurs – Divergenz im Geldfluss.`);
      else findings.push(`OBV bestätigt den ${obvTrend > 0 ? "Aufwärts" : "Abwärts"}trend.`);
    }
    const prior = candles.slice(-21, -1);
    const hi = Math.max(...prior.map((c) => c.high));
    const lo = Math.min(...prior.map((c) => c.low));
    if (lastC.close > hi) {
      breakout = "up";
      const conf = (relVol ?? 1) >= vo.relVolBreakout;
      sum += conf ? 0.4 : 0.1;
      findings.push(conf ? "Ausbruch über das 20-Perioden-Hoch mit Volumenbestätigung." : "Ausbruch nach oben – aber ohne Volumen. Misstrauen angebracht.");
    } else if (lastC.close < lo) {
      breakout = "down";
      const conf = (relVol ?? 1) >= vo.relVolBreakout;
      sum -= conf ? 0.4 : 0.1;
      findings.push(conf ? "Bruch unter das 20-Perioden-Tief mit Volumen." : "Bruch nach unten ohne Volumendruck.");
    }
    if (count && count.pattern === "impulse" && count.pivots.length >= 4) {
      const p = count.pivots;
      const v1 = avgVolume(candles, p[0].index, p[1].index);
      const v3 = avgVolume(candles, p[2].index, p[3].index);
      waveVolumeConfirmed = v3 >= v1;
      sum += (waveVolumeConfirmed ? 0.3 : -0.15) * count.direction;
      findings.push(waveVolumeConfirmed ? "Volumen in Welle 3 über Welle 1 – Impuls bestätigt." : "Welle 3 mit weniger Volumen als Welle 1 – Zählung fragwürdig.");
    } else if (count && count.complete && count.pivots.length >= 4 && !count.pattern.startsWith("triangle")) {
      const p = count.pivots;
      const vA = avgVolume(candles, p[0].index, p[1].index);
      const vEnd = avgVolume(candles, p[p.length - 2].index, p[p.length - 1].index);
      waveVolumeConfirmed = vEnd < vA;
      sum += (waveVolumeConfirmed ? 0.2 : -0.1) * count.bias;
      findings.push(waveVolumeConfirmed ? "Volumen trocknet in der letzten Teilwelle aus – Erschöpfung der Korrektur." : "Kein Volumenrückgang zum Korrekturende.");
    }
    profile = volumeProfile(candles.slice(-200));
    if (profile) {
      const above = lastC.close > profile.poc;
      sum += above ? 0.1 : -0.1;
      findings.push(`Kurs ${above ? "über" : "unter"} dem Point of Control (${profile.poc.toPrecision(5)}) – ${above ? "Unterstützung" : "Widerstand"} durch Hochvolumenzone.`);
    }
  } else if (!hasVolume) {
    findings.push("Keine Volumendaten verfügbar – Bewertung nur auf RSI-Basis.");
  }

  const score = Math.round(50 + 50 * clamp(sum / 1.5, -1, 1));
  return { score, rsi: last, rsiState, divergences: divs, relVolume: relVol, obvTrend, breakout, waveVolumeConfirmed, profile, findings, hasVolume };
}
