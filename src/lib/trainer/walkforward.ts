// Echter Walk-Forward mit Zeitbudget (fortsetzbar), gemeinsam für den nächtlichen Server-Lauf und das Training im Browser.
//
// Je Reihe: Kurse ohne die gesperrten letzten 12 Monate → Folds. Für jeden Parametersatz wird EIN Backtest über die
// ganze Lernzeit gerechnet (jedes Signal sieht nur Kerzen bis zu seinem Zeitpunkt). Danach:
//   Fold k:  Auswahl NUR mit Trades, die vor B_k abgeschlossen sind  →  Prüfung mit Trades, die in [B_k, B_k+1) beginnen.
//   Final:   Auswahl mit allen Trades vor dem Sperrbereich → diese Werte würden übernommen.
// Vergleich alt/neu ausschließlich auf den Prüfbereichen (unbekannte Daten).
import { strictnessErrors, type LearnableParams } from "../analysis/params";
import type { Candle } from "../types";
import { backtestSeries, decide, metrics, preselect, primaryRate, splitHoldout, walkForwardFolds, withZones, type Decision, type Metrics } from "./engine";
import { candidateMoves, stepLimitErrors } from "./moves";
import type { CellKey, SeriesSpec } from "./universe";

export interface RunData {
  r: number[];
  en: number[];
  ex: number[];
  /** Zonen wie HKCM: Signalzeit, Zeitpunkt des Ergebnisses, 1 = Erfolg / 0 = gescheitert, Richtung, Ober-/Unterkante */
  zt?: number[];
  za?: number[];
  zo?: number[];
  zd?: number[];
  zp?: number[];
  zb?: number[];
}
export interface SeriesInfo {
  /** Erste handelbare Zeit (nach Vorlauf) */
  start: number;
  /** B_0 … B_{F-1}, E (E = Beginn des Sperrbereichs) */
  bounds: number[];
}
export interface PoolEntry {
  params: LearnableParams;
  change: string;
  runs: (RunData | null)[];
}
export interface WFResult {
  base: Metrics;
  cand: Metrics;
  decision: Decision;
  deployed: LearnableParams;
  changes: string;
  improved: boolean;
}
export type WFPhase = "load" | "backtest" | "select" | "verify" | "done";
export interface WFState {
  cell: CellKey;
  specs: SeriesSpec[];
  folds: number;
  baseKey: string;
  info: (SeriesInfo | null | "failed")[];
  pool: Record<string, PoolEntry>;
  /** aktueller Stand je Fold (0…F-1) und final (F) */
  climbers: string[];
  stage: "gen" | "eval" | "select" | "done";
  step: number;
  maxSteps: number;
  candidatesPerStep: number;
  rotation: number;
  result?: WFResult;
}

export const keyOf = (p: LearnableParams) => JSON.stringify(p, Object.keys(p).sort());
const MONTH = 30.44 * 86400;
const WARMUP = 150;

export function initWF(cell: CellKey, specs: SeriesSpec[], base: LearnableParams, o: { folds?: number; maxSteps?: number; candidatesPerStep?: number; rotation?: number } = {}): WFState {
  const folds = o.folds ?? 4;
  const k = keyOf(base);
  return {
    cell,
    specs,
    folds,
    baseKey: k,
    info: specs.map(() => null),
    pool: { [k]: { params: base, change: "bisheriger Stand", runs: specs.map(() => null) } },
    climbers: Array.from({ length: folds + 1 }, () => k),
    stage: "eval",
    step: 0,
    maxSteps: o.maxSteps ?? 1,
    candidatesPerStep: o.candidatesPerStep ?? 6,
    rotation: o.rotation ?? 0,
  };
}

export function seriesInfo(pre: Candle[], folds: number): SeriesInfo | null {
  const fs = walkForwardFolds(pre.length, folds, WARMUP);
  if (!fs.length) return null;
  return { start: pre[WARMUP].time, bounds: [...fs.map((f) => pre[f.train[1]].time), pre[pre.length - 1].time + 1] };
}

type Region = { kind: "train" | "test"; k: number };

/** Kennzahlen eines Parametersatzes in einem Bereich (über alle Reihen). */
export function regionMetrics(st: WFState, key: string, reg: Region): Metrics | null {
  const e = st.pool[key];
  if (!e) return null;
  const trades: { returnPct: number; exitTime: number }[] = [];
  const zones: number[] = [];
  let months = 0;
  for (let s = 0; s < st.specs.length; s++) {
    const inf = st.info[s];
    if (inf === "failed") continue;
    const run = e.runs[s];
    if (!inf || !run) return null;
    let a: number, b: number;
    if (reg.kind === "train") {
      a = inf.start;
      b = reg.k >= st.folds ? inf.bounds[st.folds] : inf.bounds[reg.k];
      run.ex.forEach((x, i) => x < b && run.en[i] >= a && trades.push({ returnPct: run.r[i], exitTime: x }));
      // Lerndaten: nur Zonen, deren Ergebnis vor dem Prüfbeginn feststand
      run.za?.forEach((x, i) => x < b && run.zt![i] >= a && zones.push(run.zo![i]));
    } else {
      a = inf.bounds[reg.k];
      b = inf.bounds[reg.k + 1];
      run.en.forEach((x, i) => x >= a && x < b && trades.push({ returnPct: run.r[i], exitTime: run.ex[i] }));
      run.zt?.forEach((x, i) => x >= a && x < b && zones.push(run.zo![i]));
    }
    months += Math.max(0, b - a) / MONTH;
  }
  return withZones(metrics(trades, months), zones);
}

/** Prüfdaten-Kennzahlen: je Fold der dort gewählte Stand, zusammengefasst. */
export function oosMetrics(st: WFState, keys: string[]): Metrics | null {
  const trades: { returnPct: number; exitTime: number }[] = [];
  const zones: number[] = [];
  let months = 0;
  for (let k = 0; k < st.folds; k++) {
    const e = st.pool[keys[k]];
    for (let s = 0; s < st.specs.length; s++) {
      const inf = st.info[s];
      if (inf === "failed") continue;
      const run = e?.runs[s];
      if (!inf || !run) return null;
      const a = inf.bounds[k];
      const b = inf.bounds[k + 1];
      run.en.forEach((x, i) => x >= a && x < b && trades.push({ returnPct: run.r[i], exitTime: run.ex[i] }));
      run.zt?.forEach((x, i) => x >= a && x < b && zones.push(run.zo![i]));
      months += (b - a) / MONTH;
    }
  }
  return withZones(metrics(trades, months), zones);
}

/** Quote je Prüfzeitraum (Fold) – für die Beständigkeits-Prüfung. */
export function foldRates(st: WFState, keys: string[]): (number | null)[] {
  const out: (number | null)[] = [];
  for (let k = 0; k < st.folds; k++) {
    const e = st.pool[keys[k]];
    let ok = 0;
    let n = 0;
    for (let s = 0; s < st.specs.length; s++) {
      const inf = st.info[s];
      const run = e?.runs[s];
      if (inf === "failed" || !inf || !run) continue;
      const a = inf.bounds[k];
      const b = inf.bounds[k + 1];
      run.zt?.forEach((x, i) => {
        if (x >= a && x < b) {
          n++;
          ok += run.zo![i];
        }
      });
    }
    out.push(n ? ok / n : null);
  }
  return out;
}

/**
 * Kein Zufall (2): Die Verbesserung muss in mindestens 3 von 4 Prüfzeiträumen auftreten – nicht nur in einem.
 * Gibt einen Grund zurück, wenn sie das nicht tut.
 */
export function consistencyError(st: WFState, candKeys: string[], refKey: string): string | null {
  const c = foldRates(st, candKeys);
  const r = foldRates(st, Array.from({ length: st.folds }, () => refKey));
  let better = 0;
  let counted = 0;
  for (let k = 0; k < st.folds; k++) {
    if (c[k] == null || r[k] == null) continue;
    counted++;
    if (c[k]! > r[k]!) better++;
  }
  const need = Math.ceil(counted * 0.75);
  return counted && better < need ? `nur in ${better} von ${counted} Prüfzeiträumen besser (mindestens ${need} nötig)` : null;
}

const complete = (st: WFState, key: string) => st.pool[key]?.runs.every((r, s) => r != null || st.info[s] === "failed");

export interface WFContext {
  load: (spec: SeriesSpec) => Promise<Candle[] | null>;
  now?: () => number;
  deadline: number;
  onPhase?: (p: WFPhase, detail: string) => void;
}

/** Arbeitet weiter, bis fertig oder Zeit um. true = fertig (result gesetzt). */
export async function advanceWF(st: WFState, ctx: WFContext): Promise<boolean> {
  const now = ctx.now ?? Date.now;
  let guard = 0;
  while (st.stage !== "done" && guard++ < 10_000) {
    if (guard > 1 && now() >= ctx.deadline) return false;
    if (st.stage === "gen") {
      const keys = generate(st);
      if (!keys.length) {
        finalizeWF(st);
        break;
      }
      st.stage = "eval";
    } else if (st.stage === "eval") {
      const ok = await evaluatePending(st, ctx, now);
      if (!ok) return false;
      st.stage = "select";
    } else if (st.stage === "select") {
      ctx.onPhase?.("select", `Schritt ${st.step + 1}`);
      const moved = select(st);
      st.step++;
      if (st.step > st.maxSteps || (!moved && !hasUnexplored(st))) {
        finalizeWF(st);
        break;
      }
      st.stage = "gen";
    }
  }
  return st.stage === "done";
}

function neighbourKeys(st: WFState, key: string): { key: string; params: LearnableParams; change: string }[] {
  return candidateMoves(st.pool[key].params).map((m) => ({ key: keyOf(m.params), ...m }));
}

function hasUnexplored(st: WFState): boolean {
  return [...new Set(st.climbers)].some((c) => neighbourKeys(st, c).some((n) => !st.pool[n.key]));
}

/** Neue Kandidaten: kleine Schritte um den aktuellen Stand jedes Folds (rotierend, begrenzt). */
function generate(st: WFState): string[] {
  const all: { key: string; params: LearnableParams; change: string }[] = [];
  const seen = new Set<string>();
  // Finaler Stand zuerst (er wird übernommen), dann die Folds
  for (const c of [st.climbers[st.folds], ...st.climbers.slice(0, st.folds)]) {
    for (const n of neighbourKeys(st, c)) if (!st.pool[n.key] && !seen.has(n.key)) (seen.add(n.key), all.push(n));
  }
  if (!all.length) return [];
  const off = st.rotation % all.length;
  st.rotation += st.candidatesPerStep;
  const picked = [...all.slice(off), ...all.slice(0, off)].slice(0, st.candidatesPerStep);
  for (const n of picked) st.pool[n.key] = { params: n.params, change: n.change, runs: st.specs.map(() => null) };
  return picked.map((n) => n.key);
}

const cache = new WeakMap<WFState, Map<number, Candle[] | null>>();

async function evaluatePending(st: WFState, ctx: WFContext, now: () => number): Promise<boolean> {
  const mem = cache.get(st) ?? new Map<number, Candle[] | null>();
  cache.set(st, mem);
  const keys = Object.keys(st.pool);
  let didOne = false; // mindestens eine Einheit je Aufruf, damit es immer vorangeht
  for (let s = 0; s < st.specs.length; s++) {
    if (st.info[s] === "failed") continue;
    const todo = keys.filter((k) => st.pool[k].runs[s] == null);
    if (!todo.length) continue;
    if (didOne && now() >= ctx.deadline) return false;
    if (!mem.has(s)) {
      ctx.onPhase?.("load", st.specs[s].symbol);
      let full: Candle[] | null = null;
      try {
        full = await ctx.load(st.specs[s]);
      } catch {
        full = null;
      }
      const pre = full && full.length >= 300 ? splitHoldout(full, 12).train : null; // letzte 12 Monate gesperrt
      mem.set(s, pre && pre.length >= 300 ? pre : null);
    }
    const pre = mem.get(s);
    const inf = pre ? (st.info[s] as SeriesInfo | null) ?? seriesInfo(pre, st.folds) : null;
    if (!pre || !inf) {
      st.info[s] = "failed";
      continue;
    }
    st.info[s] = inf;
    for (const k of todo) {
      if (didOne && now() >= ctx.deadline) return false;
      didOne = true;
      ctx.onPhase?.("backtest", `${st.specs[s].symbol} · ${st.pool[k].change}`);
      const spec = st.specs[s];
      const r = backtestSeries({ name: spec.symbol, kind: spec.kind, horizon: spec.horizon, interval: spec.interval, candles: pre }, st.pool[k].params, { step: spec.step, warmup: WARMUP });
      const rd = (x: number) => Math.round(x * 1e6) / 1e6;
      st.pool[k].runs[s] = {
        r: r.trades.map((t) => Math.round(t.returnPct * 100) / 100),
        en: r.trades.map((t) => t.entryTime),
        ex: r.trades.map((t) => t.exitTime),
        zt: r.zones.map((z) => z.t),
        za: r.zones.map((z) => z.at),
        zo: r.zones.map((z) => z.ok),
        zd: r.zones.map((z) => z.dir),
        zp: r.zones.map((z) => rd(z.top)),
        zb: r.zones.map((z) => rd(z.bottom)),
      };
    }
  }
  return true;
}

/** Je Fold: besten Nachbarn NUR nach den Lerndaten dieses Folds wählen. */
function select(st: WFState): boolean {
  let moved = false;
  for (let k = 0; k <= st.folds; k++) {
    const cur = st.climbers[k];
    if (!complete(st, cur)) continue;
    const curM = regionMetrics(st, cur, { kind: "train", k });
    if (!curM) continue;
    let best: { key: string; m: Metrics } | null = null;
    for (const n of neighbourKeys(st, cur)) {
      if (!st.pool[n.key] || !complete(st, n.key)) continue;
      const m = regionMetrics(st, n.key, { kind: "train", k });
      if (!m || m.trades < Math.max(10, curM.trades * 0.5) || (m.zones ?? 0) < Math.max(10, (curM.zones ?? 0) * 0.5) || !preselect(curM, m)) continue;
      if (!best || primaryRate(m) > primaryRate(best.m) || (primaryRate(m) === primaryRate(best.m) && m.profitFactor > best.m.profitFactor)) best = { key: n.key, m };
    }
    if (best) {
      st.climbers[k] = best.key;
      moved = true;
    }
  }
  return moved;
}

/** Abschluss: alt gegen neu NUR auf unbekannten Daten; alle Strenge-Regeln. */
export function finalizeWF(st: WFState): WFResult | null {
  if (st.stage === "eval" || st.stage === "gen") select(st); // Zeit um: mit dem bisher Ausgewerteten abschließen
  st.stage = "done";
  const baseKeys = Array.from({ length: st.folds }, () => st.baseKey);
  const base = oosMetrics(st, baseKeys);
  const cand = oosMetrics(st, st.climbers.slice(0, st.folds).map((k) => (complete(st, k) ? k : st.baseKey)));
  if (!base || !cand) return (st.result = undefined), null;
  const deployedKey = complete(st, st.climbers[st.folds]) ? st.climbers[st.folds] : st.baseKey;
  const deployed = st.pool[deployedKey].params;
  const d = decide(base, cand);
  const strict = [...strictnessErrors(st.pool[st.baseKey].params, deployed), ...stepLimitErrors(st.pool[st.baseKey].params, deployed)];
  if (deployedKey === st.baseKey) d.reasons.push("Auf allen Lerndaten zusammen keine bessere Einstellung gefunden");
  const cons = consistencyError(st, st.climbers.slice(0, st.folds).map((k) => (complete(st, k) ? k : st.baseKey)), st.baseKey);
  if (cons) d.reasons.push(cons);
  d.reasons.push(...strict);
  d.accept = d.reasons.length === 0;
  st.result = { base, cand, decision: d, deployed, changes: describeChanges(st.pool[st.baseKey].params, deployed), improved: d.accept };
  return st.result;
}

export function describeChanges(a: LearnableParams, b: LearnableParams): string {
  const out: string[] = [];
  for (const k of Object.keys(b) as (keyof LearnableParams)[]) {
    const x = JSON.stringify(a[k]);
    const y = JSON.stringify(b[k]);
    if (x !== y) out.push(`${k} ${fmt(a[k])} → ${fmt(b[k])}`);
  }
  return out.join(", ") || "keine";
}
const fmt = (v: unknown) => (v && typeof v === "object" ? Object.values(v as object).join("/") : String(v));

/** Verkleinert den Zustand zum Speichern (Backtests werden beim Fortsetzen neu gerechnet). */
export function compactWF(st: WFState): WFState {
  const keep = new Set([st.baseKey, ...st.climbers]);
  const pool: Record<string, PoolEntry> = {};
  for (const k of keep) pool[k] = { ...st.pool[k], runs: st.specs.map(() => null) };
  return { ...st, pool, info: st.specs.map(() => null), stage: st.stage === "done" ? "done" : "eval" };
}

/** Zuletzt gespeicherter Stand während einer Sitzung (Vergleichsbasis für die nächste Verbesserung). */
export interface SavedPoint {
  key: string;
  oos: Metrics;
  params: LearnableParams;
}

/**
 * Zwischenprüfung (für sofortiges Speichern): Ist der aktuelle Stand auf den unbekannten Prüfdaten besser als der
 * zuletzt gespeicherte (bzw. der Ausgangsstand)? Nutzt nur bereits gerechnete Backtests – keine neuen Daten.
 */
export function improvementCheck(st: WFState, last?: SavedPoint): WFResult | null {
  const finalKey = st.climbers[st.folds];
  if (!complete(st, finalKey) || !complete(st, st.baseKey)) return null;
  if (finalKey === (last?.key ?? st.baseKey)) return null;
  const cand = oosMetrics(st, st.climbers.slice(0, st.folds).map((k) => (complete(st, k) ? k : st.baseKey)));
  const base = last?.oos ?? oosMetrics(st, Array.from({ length: st.folds }, () => st.baseKey));
  if (!cand || !base) return null;
  const prev = last?.params ?? st.pool[st.baseKey].params;
  const deployed = st.pool[finalKey].params;
  const d = decide(base, cand);
  const refKey = last && complete(st, last.key) ? last.key : st.baseKey;
  const cons = consistencyError(st, st.climbers.slice(0, st.folds).map((k) => (complete(st, k) ? k : st.baseKey)), refKey);
  if (cons) d.reasons.push(cons);
  d.reasons.push(...strictnessErrors(prev, deployed), ...stepLimitErrors(prev, deployed));
  d.accept = d.reasons.length === 0;
  return { base, cand, decision: d, deployed, changes: describeChanges(prev, deployed), improved: d.accept };
}

/** Woran an den Elliott-Wellen gerade gearbeitet wird (für die Anzeige). */
export function focusLabel(change: string): string {
  const k = change.split(" ")[0];
  const map: Record<string, string> = {
    zoneAtrMult: "Einstiegszonen in Korrekturwellen",
    Wellengrade: "Wellen-Erkennung (Wellengrade)",
    elliottDegrees: "Wellen-Erkennung (Wellengrade)",
    fibToleranceScale: "Fibonacci-Zonen der Wellen 2 und 4",
    rankFibWeight: "Haupt- und Alternativzählung",
    rankContextStrength: "Haupt- und Alternativzählung",
    elliottAgreement: "Bestätigung durch das Wellenbild",
    wave5Filter: "Ende von Welle 5 erkennen",
    htfConfirm: "Übergeordnete Welle",
    wave5Exit: "Ausstieg am Ende von Welle 5",
    divergenceRecentBars: "Divergenzen am Wellenende",
    rsiOverbought: "Momentum der Wellen (RSI)",
    rsiOversold: "Momentum der Wellen (RSI)",
    relVolHigh: "Volumen der Wellen",
    relVolBreakout: "Volumen der Wellen",
    relVolLow: "Volumen der Wellen",
    minStrength: "Signalqualität",
    Gewichtung: "Gewichtung",
    bisheriger: "Ausgangsstand messen",
  };
  return map[k] ?? "Wellenzählung";
}

/** Messprotokoll: jede bewertete Zone der Prüfbereiche für einen Stand (Fold-Wahl `keys`). */
export interface ProtocolEntry {
  symbol: string;
  tf: string;
  t: number;
  dir: 1 | -1;
  top: number;
  bottom: number;
  ok: 0 | 1;
}
export function protocolOf(st: WFState, keys: string[]): ProtocolEntry[] {
  const out: ProtocolEntry[] = [];
  for (let k = 0; k < st.folds; k++) {
    const e = st.pool[keys[k]];
    for (let s = 0; s < st.specs.length; s++) {
      const inf = st.info[s];
      const run = e?.runs[s];
      if (!inf || inf === "failed" || !run?.zt) continue;
      const a = inf.bounds[k];
      const b = inf.bounds[k + 1];
      run.zt.forEach((x, i) => {
        if (x >= a && x < b) out.push({ symbol: st.specs[s].symbol, tf: st.specs[s].interval, t: x, dir: run.zd![i] as 1 | -1, top: run.zp![i], bottom: run.zb![i], ok: run.zo![i] as 0 | 1 });
      });
    }
  }
  return out.sort((x, y) => x.t - y.t);
}
