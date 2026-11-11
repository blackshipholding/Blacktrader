// Trainer-Kern: Signal-Backtest mit lernbaren Werten, Kennzahlen, Walk-Forward und Annahmeregeln.
// Methode, Gewichtung und Risiko bleiben fest (locked-config.ts) – hier werden nur LearnableParams variiert.
import { analyze } from "../analysis/analyze";
import type { BacktestTrade } from "../analysis/backtest";
import { DEFAULT_PARAMS, PARAM_BOUNDS, validateParams, type LearnableParams } from "../analysis/params";
import { runZoneBacktest } from "../analysis/zoneBacktest";
import { zoneOutcome } from "../analysis/zoneOutcome";
import { LOCKED } from "../analysis/locked-config";
import type { ZoneSetup } from "../analysis/zones";
import type { AssetKind, Candle, Horizon, Interval } from "../types";

export interface Metrics {
  trades: number;
  hitRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  maxDrawdown: number;
  /** Signale pro Monat */
  perMonth: number;
  /** Zonen mit Ergebnis und Zonen-Quote wie HKCM (eingetaucht, vor der Unterkante gedreht, oben heraus) */
  zones?: number;
  zoneRate?: number;
}

/** Hauptmaß für das 70-%-Ziel: Zonen-Quote (wie HKCM), sonst Trade-Quote (ältere Messungen). */
export const primaryRate = (m: Metrics) => (m.zones != null ? (m.zoneRate ?? 0) : m.hitRate);
export const primaryCount = (m: Metrics) => (m.zones != null ? m.zones : m.trades);

/** Zonen-Ergebnisse an Kennzahlen anhängen. */
export function withZones(m: Metrics, ok: number[]): Metrics {
  return { ...m, zones: ok.length, zoneRate: ok.length ? ok.filter((x) => x === 1).length / ok.length : 0 };
}

export function metrics(trades: Pick<BacktestTrade, "returnPct" | "exitTime">[], months: number): Metrics {
  const wins = trades.filter((t) => t.returnPct > 0);
  const losses = trades.filter((t) => t.returnPct <= 0);
  const gw = wins.reduce((a, t) => a + t.returnPct, 0);
  const gl = -losses.reduce((a, t) => a + t.returnPct, 0);
  let eq = 1;
  let peak = 1;
  let dd = 0;
  for (const t of [...trades].sort((a, b) => a.exitTime - b.exitTime)) {
    eq *= 1 + t.returnPct / 100;
    peak = Math.max(peak, eq);
    dd = Math.min(dd, eq / peak - 1);
  }
  return {
    trades: trades.length,
    hitRate: trades.length ? wins.length / trades.length : 0,
    avgWin: wins.length ? gw / wins.length : 0,
    avgLoss: losses.length ? -gl / losses.length : 0,
    profitFactor: gl > 0 ? gw / gl : wins.length ? 99 : 0,
    maxDrawdown: dd * 100,
    perMonth: months > 0 ? trades.length / months : 0,
  };
}

export interface Series {
  name: string;
  kind: AssetKind;
  horizon: Horizon;
  interval: Interval;
  candles: Candle[];
}

/** Analyse → Signal (gleiche Logik wie in der App, inkl. lernbarer Werte). */
export function signalFromAnalysis(hist: Candle[], s: Pick<Series, "kind" | "horizon" | "interval">, params: LearnableParams): ZoneSetup | null {
  const r = analyze({ symbol: "T", name: "T", candles: hist, horizon: s.horizon, interval: s.interval, kind: s.kind, params });
  if (!r || !r.plan || r.decision.level === "neutral") return null;
  const p = r.plan;
  return {
    direction: p.direction,
    a: { index: 0, time: 0, price: 0, type: "L", confirmed: true },
    b: { index: 0, time: 0, price: p.cancelAbove ?? p.entry, type: "H", confirmed: true },
    zoneStart: p.zoneStart ?? p.entry,
    zoneEnd: p.zoneEnd ?? p.entry,
    entry: p.entry,
    stop: p.stop,
    targets: p.targets,
    riskReward: p.riskReward,
    cancelAbove: p.cancelAbove ?? p.entry,
    inZone: p.orderType === "market",
    wave5Exit: !!p.wave5Exit,
    atr: (p.trailDistance ?? 0) / LOCKED.trade.trailAtr,
  };
}

/** Backtest einer Kursreihe mit Parametern (Trade-Regeln fest). */
export interface ZoneRecord {
  /** Zeitpunkt des Signals, Zeitpunkt des Ergebnisses */
  t: number;
  at: number;
  /** 1 = Erfolg, 0 = gescheitert */
  ok: number;
  dir: 1 | -1;
  top: number;
  bottom: number;
}

export function backtestSeries(s: Series, params: LearnableParams, opts: { warmup?: number; step?: number } = {}) {
  const zones: ZoneRecord[] = [];
  const seen = new Set<string>();
  const r = runZoneBacktest(s.candles, {
    warmup: opts.warmup ?? 150,
    step: opts.step,
    signalAt: (h) => signalFromAnalysis(h, s, params),
    // Jede neue Zone einmal nach HKCM-Art bewerten (nur Kerzen nach dem Signal)
    onSignal: ({ index, time, setup }) => {
      const key = `${setup.zoneStart}:${setup.zoneEnd}`;
      if (seen.has(key)) return;
      seen.add(key);
      const dir = setup.direction === "long" ? 1 : -1;
      const o = zoneOutcome(s.candles, index, { top: setup.zoneStart, bottom: setup.zoneEnd, dir, cancel: setup.cancelAbove, maxWait: LOCKED.trade.maxWaitBars });
      if (o) zones.push({ t: time, at: o.at, ok: o.result === "erfolg" ? 1 : 0, dir, top: setup.zoneStart, bottom: setup.zoneEnd });
    },
  });
  return { ...r, zones };
}

const monthsOf = (c: Candle[]) => (c.length > 1 ? (c[c.length - 1].time - c[0].time) / (30.44 * 86400) : 0);

/** Teilt die letzten `months` Monate als gesperrten Abschlusstest ab. */
export function splitHoldout(c: Candle[], months = 12): { train: Candle[]; holdout: Candle[] } {
  if (!c.length) return { train: [], holdout: [] };
  const cut = c[c.length - 1].time - months * 30.44 * 86400;
  const i = c.findIndex((x) => x.time >= cut);
  return { train: i < 0 ? c : c.slice(0, i), holdout: i < 0 ? [] : c.slice(i) };
}

export interface Fold {
  /** Kerzenbereich, auf dem gelernt wird */
  train: [number, number];
  /** Folgender, unbekannter Bereich (inkl. Vorlauf für Indikatoren) */
  test: [number, number];
}

/** Walk-Forward: Lernen auf A, Prüfen auf dem folgenden B, dann weiterrollen. */
export function walkForwardFolds(n: number, folds = 4, warmup = 150): Fold[] {
  const usable = n - warmup;
  if (usable < 100) return [];
  const block = Math.floor(usable / (folds + 1));
  const out: Fold[] = [];
  for (let k = 0; k < folds; k++) {
    const trainEnd = warmup + block * (k + 1);
    const testEnd = Math.min(n, trainEnd + block);
    out.push({ train: [0, trainEnd], test: [trainEnd - warmup, testEnd] });
  }
  return out;
}

export interface Evaluation {
  oos: Metrics;
  /** Trades nur aus den Prüfbereichen */
  oosTrades: number;
}

export interface SeriesTrades {
  trades: BacktestTrade[];
  months: number;
}

/** Trades einer Reihe NUR aus den unbekannten Prüfbereichen der Folds. */
export function oosSeries(s: Series, params: LearnableParams, folds = 4, step?: number): SeriesTrades {
  const trades: BacktestTrade[] = [];
  let months = 0;
  for (const f of walkForwardFolds(s.candles.length, folds)) {
    const slice = s.candles.slice(f.test[0], f.test[1]);
    const startTime = s.candles[f.test[0] + Math.min(150, f.test[1] - f.test[0] - 1)]?.time ?? 0;
    const r = backtestSeries({ ...s, candles: slice }, params, { step });
    trades.push(...r.trades.filter((t) => t.entryTime >= startTime));
    months += monthsOf(slice.slice(150));
  }
  return { trades, months };
}

/** Bewertet Parameter NUR auf den unbekannten Prüfbereichen der Folds. */
export function evaluateOOS(series: Series[], params: LearnableParams, folds = 4, step?: number): Evaluation {
  const trades: BacktestTrade[] = [];
  let months = 0;
  for (const s of series) {
    const r = oosSeries(s, params, folds, step);
    trades.push(...r.trades);
    months += r.months;
  }
  return { oos: metrics(trades, months), oosTrades: trades.length };
}

/** Gesperrter Abschlusstest: nur Trades, die im Abschlusszeitraum (letzte 12 Monate) beginnen. */
export function holdoutSeries(s: Series, params: LearnableParams, months = 12, step?: number): SeriesTrades {
  const { train, holdout } = splitHoldout(s.candles, months);
  if (holdout.length < 2) return { trades: [], months: 0 };
  const candles = [...train.slice(-150), ...holdout];
  const r = backtestSeries({ ...s, candles }, params, { step, warmup: Math.min(150, train.length) });
  return { trades: r.trades.filter((t) => t.entryTime >= holdout[0].time), months: monthsOf(holdout) };
}

export const MIN_SIGNALS_VALID = LOCKED.acceptance.minSignals;
export const TARGET_HIT_RATE = 0.7;

export interface Decision {
  accept: boolean;
  reasons: string[];
}

/**
 * Kein Zufall: Ist die höhere Quote statistisch gesichert? Einseitiger Test zweier Anteile (95 %, z ≥ 1,645).
 * Bei sich überschneidenden Prüfdaten ist dieser Test eher streng (er verlangt mehr Abstand als nötig).
 */
export const SIGNIFICANCE_Z = 1.645;
export function significance(a: number, n1: number, b: number, n2: number): number {
  if (n1 <= 0 || n2 <= 0) return 0;
  const p = (a * n1 + b * n2) / (n1 + n2);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  return se > 0 ? (a - b) / se : 0;
}

/**
 * Regeln gegen Selbstbetrug: nur übernehmen, wenn auf UNBEKANNTEN Daten
 * Trefferquote höher (und statistisch gesichert, kein Zufall), Profit-Faktor nicht niedriger,
 * Signale/Monat höchstens −40 %, genug Signale.
 */
export function decide(base: Metrics, cand: Metrics): Decision {
  const reasons: string[] = [];
  const zonal = base.zones != null && cand.zones != null;
  const n = zonal ? cand.zones! : cand.trades;
  const a = zonal ? cand.zoneRate! : cand.hitRate;
  const b = zonal ? base.zoneRate! : base.hitRate;
  if (n < MIN_SIGNALS_VALID) reasons.push(`zu wenige ${zonal ? "Zonen" : "Signale"} (${n} < ${MIN_SIGNALS_VALID})`);
  if (a <= b) reasons.push(`${zonal ? "Zonen-Quote" : "Trefferquote"} nicht besser (${(a * 100).toFixed(1)} % ≤ ${(b * 100).toFixed(1)} %)`);
  else {
    const z = significance(a, n, b, zonal ? base.zones! : base.trades);
    if (z < SIGNIFICANCE_Z) reasons.push(`Verbesserung könnte Zufall sein (${(a * 100).toFixed(1)} % gegen ${(b * 100).toFixed(1)} %, nicht mit 95 % Sicherheit)`);
  }
  if (cand.profitFactor < base.profitFactor) reasons.push(`Profit-Faktor gesunken (${cand.profitFactor.toFixed(2)} < ${base.profitFactor.toFixed(2)})`);
  if (cand.maxDrawdown < base.maxDrawdown - 1e-9) reasons.push(`max. Rückgang schlechter (${cand.maxDrawdown.toFixed(1)} % < ${base.maxDrawdown.toFixed(1)} %)`);
  if (base.perMonth > 0 && cand.perMonth < base.perMonth * (1 - LOCKED.acceptance.maxSignalDrop)) reasons.push(`zu wenige Signale pro Monat (−${Math.round((1 - cand.perMonth / base.perMonth) * 100)} %)`);
  return { accept: reasons.length === 0, reasons };
}

/** Vorauswahl auf Lerndaten: Trefferquote höher, Profit-Faktor und Rückgang nicht schlechter, Signalmenge ≥ 60 %. */
export function preselect(baseIn: Metrics, cand: Metrics): boolean {
  const zonal = baseIn.zones != null && cand.zones != null;
  return (zonal ? cand.zoneRate! > baseIn.zoneRate! : cand.hitRate > baseIn.hitRate) && cand.profitFactor >= baseIn.profitFactor && cand.maxDrawdown >= baseIn.maxDrawdown && cand.perMonth >= baseIn.perMonth * (1 - LOCKED.acceptance.maxSignalDrop);
}

