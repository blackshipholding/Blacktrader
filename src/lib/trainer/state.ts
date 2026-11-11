// Zustand des Trainers: Parameter-Versionen, Änderungsprotokoll, Verlauf, laufender Lern-Job.
// Reine Datenlogik ohne Speicherzugriff (testbar).
import type { ParamSet } from "../analysis/params";
import { metrics, type Metrics } from "./engine";
import type { WFState } from "./walkforward";
import type { CellKey, SeriesSpec } from "./universe";

export type LogKind = "angenommen" | "abgelehnt" | "zurückgesetzt" | "abschlusstest" | "info";

export interface LogEntry {
  date: string;
  kind: LogKind;
  cell?: CellKey;
  version?: number;
  change?: string;
  reason: string;
  base?: Metrics;
  cand?: Metrics;
}

export interface HistoryPoint {
  date: string;
  cell: CellKey;
  /** "backtest" = unbekannte Prüfdaten (Walk-Forward), "live" = abgeschlossene Signale aus dem Protokoll */
  source: "backtest" | "live";
  hitRate: number;
  profitFactor: number;
  trades: number;
  version: number;
}

export interface CellStatus {
  updated: string;
  version: number;
  /** Aktueller Stand auf unbekannten Prüfdaten */
  oos: Metrics;
  series: number;
  /** Beste Trefferquote, die ein geprüfter Kandidat auf unbekannten Daten erreicht hat */
  bestSeen?: Metrics;
  note?: string;
}

export interface FinalTest {
  version: number;
  date: string;
  cells: Partial<Record<CellKey, Metrics>>;
}

/** Ergebnis einer Arbeitseinheit (eine Reihe, ein Parametersatz): Rendite % und Ausstiegszeit je Trade. */
export interface UnitResult {
  r: number[];
  t: number[];
  months: number;
}

export interface TrainJob {
  type: "train";
  cell: CellKey;
  startedAt: string;
  wf: WFState;
}

export interface FinalJob {
  type: "final";
  version: number;
  startedAt: string;
  cellIdx: number;
  specs: Partial<Record<CellKey, SeriesSpec[]>>;
  results: Partial<Record<CellKey, (UnitResult | null)[]>>;
  failed: string[];
}

/**
 * Gemeinsamer Zustand des Nachtlaufs (Protokoll, Verlauf, laufender Job, Abschlusstests).
 * Gelernte Werte und Stände liegen NICHT hier, sondern je Zelle getrennt (cells.ts).
 */
export interface TrainerState {
  schema: 2;
  log: LogEntry[];
  history: HistoryPoint[];
  /** Alte Felder (Schema 1) – nur zum einmaligen Übernehmen in die getrennten Zellen */
  versions?: { id: number; params: ParamSet }[];
  current?: number;
  cells?: Partial<Record<CellKey, CellStatus>>;
  job: TrainJob | FinalJob | null;
  /** Nächste Zelle in der Reihenfolge */
  rotation: number;
  /** Zähler für die Auswahl der Stellschrauben */
  round: number;
  finalTests: FinalTest[];
  lastRun?: string;
  lastRunNote?: string;
}

export const MAX_LOG = 400;
export const MAX_HISTORY = 3000;

export function initialState(now = new Date()): TrainerState {
  return { schema: 2, log: [{ date: now.toISOString(), kind: "info", reason: "Trainer gestartet" }], history: [], job: null, rotation: 0, round: 0, finalTests: [] };
}

export function addLog(s: TrainerState, e: Omit<LogEntry, "date"> & { date?: string }): void {
  s.log.unshift({ date: new Date().toISOString(), ...e });
  if (s.log.length > MAX_LOG) s.log.length = MAX_LOG;
}

export function addHistory(s: TrainerState, p: HistoryPoint): void {
  s.history.push(p);
  if (s.history.length > MAX_HISTORY) s.history.splice(0, s.history.length - MAX_HISTORY);
}

export function toUnit(trades: { returnPct: number; exitTime: number }[], months: number): UnitResult {
  return { r: trades.map((t) => Math.round(t.returnPct * 100) / 100), t: trades.map((t) => t.exitTime), months: Math.round(months * 100) / 100 };
}

export function unitMetrics(units: (UnitResult | null)[]): Metrics {
  const trades: { returnPct: number; exitTime: number }[] = [];
  let months = 0;
  for (const u of units) {
    if (!u) continue;
    u.r.forEach((r, i) => trades.push({ returnPct: r, exitTime: u.t[i] }));
    months += u.months;
  }
  return metrics(trades, months);
}
