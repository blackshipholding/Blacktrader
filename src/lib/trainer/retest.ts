// Nachprüfung eines Trainer-Vorschlags an einem anderen Tag (Nutzer 13.11.2026): Jeden Tag wird ein anderer Ausschnitt der
// Lernwerte (50 %) genommen, alt gegen neu auf den unbekannten Prüfbereichen verglichen – mit denselben harten Regeln wie beim
// Lernen (Mindestzahl Zonen, 95 % Sicherheit, Profit-Faktor, Rückgang, Signalmenge). Rein rechnerisch, ohne Netz.
import type { LearnableParams } from "../analysis/params";
import { backtestSeries, decide, metrics, withZones, walkForwardFolds, type Decision, type Metrics, type Series } from "./engine";
import type { BacktestTrade } from "../analysis/backtest";

/** Stabiler Zufall aus Text (FNV-1a), 0…1 */
export function hash01(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1_000_000) / 1_000_000;
}

/** Anteil der Werte je Prüftag – bei sehr vielen Werten genügt die Hälfte (Nutzer 13.11.2026) */
export const RETEST_SHARE = 0.5;

/** Ausschnitt der Werte für einen Tag: jeder Tag ein anderer, am selben Tag immer derselbe */
export function pickSubset<T extends { symbol: string }>(specs: T[], day: string, share = RETEST_SHARE): T[] {
  return specs.filter((s) => hash01(`${day}|${s.symbol}`) < share);
}

export type SeriesWithStep = Series & { step?: number };

const monthsOf = (c: { time: number }[]) => (c.length > 1 ? (c[c.length - 1].time - c[0].time) / (30.44 * 86400) : 0);

/** Kennzahlen NUR aus den unbekannten Prüfbereichen (4 Folds), Zonen-Quote nur Kauf-Zonen */
export function oosZoneMetrics(series: SeriesWithStep[], params: LearnableParams, folds = 4): Metrics {
  const trades: BacktestTrade[] = [];
  const ok: number[] = [];
  let months = 0;
  for (const s of series) {
    for (const f of walkForwardFolds(s.candles.length, folds)) {
      const slice = s.candles.slice(f.test[0], f.test[1]);
      const startTime = s.candles[f.test[0] + Math.min(150, f.test[1] - f.test[0] - 1)]?.time ?? 0;
      const r = backtestSeries({ ...s, candles: slice }, params, { step: s.step, rules: true });
      trades.push(...r.trades.filter((t) => t.entryTime >= startTime));
      for (const z of r.zones) if (z.t >= startTime && z.dir === 1) ok.push(z.ok);
      months += monthsOf(slice.slice(150));
    }
  }
  return withZones(metrics(trades, months), ok);
}

export interface RetestOutcome {
  pass: boolean;
  base: Metrics;
  cand: Metrics;
  decision: Decision;
  note: string;
}

export function retestOnSeries(series: SeriesWithStep[], base: LearnableParams, cand: LearnableParams): RetestOutcome {
  const b = oosZoneMetrics(series, base);
  const c = oosZoneMetrics(series, cand);
  const decision = decide(b, c);
  const pc = (x?: number) => `${((x ?? 0) * 100).toFixed(1).replace(".", ",")} %`;
  const note = decision.accept ? `bestanden (Zonen-Quote ${pc(c.zoneRate)} gegen ${pc(b.zoneRate)}, ${c.zones} Zonen)` : `nicht bestanden: ${decision.reasons.join("; ")}`;
  return { pass: decision.accept, base: b, cand: c, decision, note };
}
