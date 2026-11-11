// Elliott-Wellen-Zähler: erzeugt alternative Zählungen auf mehreren Swing-Graden,
// verwirft Zählungen mit Regelverstößen und rankt den Rest nach Fibo-Passung, Spezifität und Kontext.
import type { Candle } from "../../types";
import { atr } from "../indicators";
import { zigzag, type Pivot } from "../zigzag";
import {
  evalComplex,
  evalDiagonal,
  evalFlat,
  evalImpulse,
  evalTriangle,
  evalZigzag,
  PATTERN_LABEL,
  type PatternEval,
  type PatternType,
  type RuleResult,
} from "./patterns";

export { PATTERN_LABEL };
export type { PatternType, RuleResult, PatternEval };

export interface PriceLevel {
  label: string;
  price: number;
  kind: "target" | "retracement" | "invalidation";
}

export interface WaveCount {
  id: string;
  pattern: PatternType;
  patternLabel: string;
  degree: string;
  atrMult: number;
  direction: 1 | -1;
  pivots: Pivot[];
  labels: string[];
  complete: boolean;
  /** Beschreibung, welche Welle jetzt läuft/erwartet wird */
  phase: string;
  rules: RuleResult[];
  fib: number;
  quality: number;
  probability: number;
  /** Erwartete Richtung der nächsten Bewegung */
  bias: 1 | -1;
  /** Stärke der Erwartung (Welle 3 = hoch, Welle 4 = niedrig) */
  strength: number;
  stop: number;
  targets: number[];
  levels: PriceLevel[];
  notes: string[];
  extension?: 1 | 3 | 5;
}

export interface ElliottResult {
  score: number;
  counts: WaveCount[];
  best?: WaveCount;
  alternative?: WaveCount;
  contested: boolean;
  confidence: number;
}

export const DEGREES = [
  { atrMult: 1.5, name: "fein" },
  { atrMult: 2.5, name: "mittel" },
  { atrMult: 4, name: "grob" },
];

interface Template {
  size: number;
  complete: boolean;
  evaluate: (pv: Pivot[]) => PatternEval | null;
}

const TEMPLATES: Template[] = [
  { size: 3, complete: false, evaluate: evalImpulse },
  { size: 4, complete: false, evaluate: evalImpulse },
  { size: 5, complete: false, evaluate: evalImpulse },
  { size: 6, complete: true, evaluate: evalImpulse },
  { size: 6, complete: true, evaluate: (pv) => evalDiagonal(pv, "ending-diagonal") },
  { size: 6, complete: true, evaluate: (pv) => evalDiagonal(pv, "leading-diagonal") },
  { size: 3, complete: false, evaluate: evalZigzag },
  { size: 4, complete: true, evaluate: evalZigzag },
  { size: 4, complete: true, evaluate: evalFlat },
  { size: 6, complete: true, evaluate: evalTriangle },
  { size: 8, complete: true, evaluate: evalComplex },
  { size: 10, complete: true, evaluate: evalComplex },
  { size: 12, complete: true, evaluate: evalComplex },
];

const SPECIFICITY: Record<number, number> = { 3: 0.55, 4: 0.68, 5: 0.78, 6: 0.9, 8: 0.75, 10: 0.72, 12: 0.72 };

const clamp = (x: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));

interface Expectation {
  phase: string;
  bias: 1 | -1;
  strength: number;
  stop: number;
  targets: { label: string; price: number }[];
  retracements?: { label: string; price: number }[];
}

/** Leitet aus einer Zählung die erwartete nächste Bewegung samt Invalidierung und Zielen ab. */
export function expectationFor(ev: PatternEval, pv: Pivot[], a: number): Expectation {
  const d = ev.direction;
  const p = pv.map((x) => x.price);
  const L = p.slice(1).map((x, i) => Math.abs(x - p[i]));
  const last = p[p.length - 1];
  const n = pv.length - 1;
  const ext = (base: number, len: number, dir: number, ratios: number[], prefix: string) =>
    ratios.map((r) => ({ label: `${prefix} ${r.toFixed(3).replace(/\.?0+$/, "")}`, price: base + dir * len * r }));
  const retr = (from: number, to: number, ratios: number[]) =>
    ratios.map((r) => ({ label: `Retr. ${r}`, price: to - (to - from) * r }));

  switch (ev.pattern) {
    case "impulse":
      if (n === 2)
        return {
          phase: "Wellen 1-2 abgeschlossen – Welle 3 steht an",
          bias: d,
          strength: 1,
          stop: p[0],
          targets: ext(p[2], L[0], d, [1.0, 1.618, 2.618], "W3 ="),
          retracements: retr(p[0], p[1], [0.382, 0.5, 0.618]),
        };
      if (n === 3)
        return {
          phase: "Wellen 1-3 abgeschlossen – Korrekturwelle 4 läuft/steht an",
          bias: (-d) as 1 | -1,
          strength: 0.3,
          stop: last + d * a * 1,
          targets: retr(p[2], p[3], [0.236, 0.382, 0.5]).map((t) => ({ ...t, label: `W4 ${t.label}` })),
        };
      if (n === 4)
        return {
          phase: "Wellen 1-4 abgeschlossen – finale Welle 5 steht an",
          bias: d,
          strength: 0.6,
          stop: p[1],
          targets: ext(p[4], L[0], d, [0.618, 1.0, 1.618], "W5 = W1 ×"),
          retracements: retr(p[2], p[3], [0.236, 0.382, 0.5]),
        };
      return {
        phase: "Impuls vollständig – Korrektur gegen den Trend erwartet",
        bias: (-d) as 1 | -1,
        strength: 0.65,
        stop: last + d * a * 1,
        targets: [
          ...retr(p[0], p[5], [0.382, 0.5, 0.618]),
          { label: "Bereich Welle 4", price: p[4] },
        ],
      };
    case "ending-diagonal":
      return {
        phase: "Ending Diagonal vollständig – scharfe Umkehr erwartet",
        bias: (-d) as 1 | -1,
        strength: 0.75,
        stop: last + d * a * 1,
        targets: [...retr(p[0], p[5], [0.618]), { label: "Diagonal-Start", price: p[0] }],
      };
    case "leading-diagonal":
      return {
        phase: "Leading Diagonal (Welle 1) vollständig – tiefe Welle 2 erwartet",
        bias: (-d) as 1 | -1,
        strength: 0.35,
        stop: last + d * a * 1,
        targets: retr(p[0], p[5], [0.5, 0.618, 0.786]),
      };
    case "zigzag":
      if (n === 2)
        return {
          phase: "A-B abgeschlossen – Welle C steht an",
          bias: d,
          strength: 0.55,
          stop: p[0],
          targets: ext(p[2], L[0], d, [0.618, 1.0, 1.618], "C = A ×"),
        };
    // fallthrough: vollständiger Zigzag wird wie andere Korrekturen behandelt
    default: {
      const triangle = ev.pattern.startsWith("triangle");
      if (triangle)
        return {
          phase: "Dreieck vollständig – Schub in Trendrichtung erwartet",
          bias: (-d) as 1 | -1,
          strength: 0.65,
          stop: last + d * a * 1,
          targets: ext(last, L[0], -d, [0.618, 1.0], "Schub ="),
        };
      return {
        phase: `${PATTERN_LABEL[ev.pattern]} vollständig – Trendfortsetzung erwartet`,
        bias: (-d) as 1 | -1,
        strength: ev.pattern === "flat-running" ? 0.7 : 0.6,
        stop: last + d * a * 1,
        targets: [
          ...retr(p[0], last, [0.618]),
          { label: "Korrektur-Start (100 %)", price: p[0] },
          { label: "Ext. 1.618", price: last - d * Math.abs(p[0] - last) * 1.618 },
        ],
      };
    }
  }
}

function contextFactor(ev: PatternEval, pv: Pivot[], candles: Candle[]): number {
  const start = pv[0].index;
  const span = pv[pv.length - 1].index - start;
  const from = Math.max(0, start - Math.max(20, span));
  if (start - from < 5) return 0.85;
  const ref = candles[from].close;
  const d = ev.direction;
  const precedingWithD = (pv[0].price - ref) * d > 0;
  if (ev.pattern === "ending-diagonal") return precedingWithD ? 1 : 0.7;
  // Impulse und Leading Diagonals beginnen nach einer Gegenbewegung; Korrekturen laufen gegen den Vortrend.
  if (ev.pattern === "impulse" || ev.pattern === "leading-diagonal") return precedingWithD ? 0.8 : 1;
  return precedingWithD ? 0.7 : 1;
}

/** Analysiert Kerzen und gibt alle gültigen Zählungen sortiert zurück. */
export interface RankingOptions {
  /** Gewicht der Fibo-Passung im Ranking (Standard 0,65) */
  fibWeight: number;
  /** Stärke des Kontext-Abschlags (Standard 1) */
  contextStrength: number;
}

const DEFAULT_RANKING: RankingOptions = { fibWeight: 0.65, contextStrength: 1 };

/** Wellengrade aus drei ATR-Faktoren (fein, mittel, grob). */
export function degreesFrom(mults: readonly [number, number, number]) {
  return [
    { atrMult: mults[0], name: "fein" },
    { atrMult: mults[1], name: "mittel" },
    { atrMult: mults[2], name: "grob" },
  ];
}

export function analyzeElliott(candles: Candle[], degrees = DEGREES, ranking: RankingOptions = DEFAULT_RANKING): ElliottResult {
  if (candles.length < 30) return { score: 50, counts: [], contested: false, confidence: 0 };
  const price = candles[candles.length - 1].close;
  const atrs = atr(candles);
  const a = atrs[atrs.length - 1] ?? price * 0.02;
  const counts: WaveCount[] = [];
  const seen = new Set<string>();

  for (const deg of degrees) {
    const pivots = zigzag(candles, deg.atrMult);
    if (pivots.length < 3) continue;
    for (const t of TEMPLATES) {
      for (const offset of t.complete ? [0, 1] : [0]) {
        const end = pivots.length - offset;
        const startIdx = end - t.size;
        if (startIdx < 0) continue;
        const pv = pivots.slice(startIdx, end);
        const ev = t.evaluate(pv);
        if (!ev) continue;
        const key = `${ev.pattern}:${pv.map((x) => x.index).join(",")}`;
        if (seen.has(key)) continue;
        const exp = expectationFor(ev, pv, a);
        // Szenario bereits invalidiert? (Kurs jenseits der Invalidierung)
        if ((price - exp.stop) * exp.bias <= 0) continue;
        // Nach Abschluss läuft bereits die Folgebewegung: muss in Erwartungsrichtung liegen.
        if (offset === 1) {
          const lastPivot = pivots[pivots.length - 1].price;
          if ((lastPivot - pv[pv.length - 1].price) * exp.bias <= 0) continue;
        }
        seen.add(key);
        const unconfirmedEnd = !pv[pv.length - 1].confirmed && offset === 0;
        const quality = clamp(
          (1 - ranking.fibWeight + ranking.fibWeight * ev.fib) *
            (SPECIFICITY[t.size] ?? 0.7) *
            (1 - (1 - contextFactor(ev, pv, candles)) * ranking.contextStrength) *
            (offset === 1 ? 0.9 : 1) *
            (unconfirmedEnd ? 0.92 : 1),
        );
        const levels: PriceLevel[] = [
          ...exp.targets.map((x) => ({ ...x, kind: "target" as const })),
          ...(exp.retracements ?? []).map((x) => ({ ...x, kind: "retracement" as const })),
          { label: "Invalidierung", price: exp.stop, kind: "invalidation" },
        ];
        counts.push({
          id: `${deg.name}-${key}-${offset}`,
          pattern: ev.pattern,
          patternLabel: PATTERN_LABEL[ev.pattern],
          degree: deg.name,
          atrMult: deg.atrMult,
          direction: ev.direction,
          pivots: pv,
          labels: ev.labels,
          complete: t.complete,
          phase: exp.phase,
          rules: ev.rules,
          fib: ev.fib,
          quality,
          probability: 0,
          bias: exp.bias,
          strength: exp.strength,
          stop: exp.stop,
          targets: exp.targets.map((x) => x.price),
          levels,
          notes: ev.notes,
          extension: ev.extension,
        });
      }
    }
  }

  counts.sort((x, y) => y.quality - x.quality);
  const top = counts.slice(0, 8);
  const z = top.reduce((s, c) => s + c.quality ** 2, 0) || 1;
  top.forEach((c) => (c.probability = c.quality ** 2 / z));

  const best = top[0];
  if (!best) return { score: 50, counts: [], contested: false, confidence: 0 };
  const alternative = top.find((c) => c !== best && (c.bias !== best.bias || c.pattern !== best.pattern));
  const contested = !!alternative && alternative.bias !== best.bias && alternative.quality >= best.quality * 0.85;
  const confidence = clamp((best.quality - 0.3) / 0.45) * (contested ? 0.5 : 1);
  const score = clamp(50 + 50 * best.bias * best.strength * confidence, 0, 100);
  return { score: Math.round(score), counts: top, best, alternative, contested, confidence };
}
