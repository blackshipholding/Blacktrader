// Trainingssitzung im Browser (läuft im Web Worker): feste Dauer, Bereiche nacheinander, Fortschritt speicherbar.
// Jeder Bereich: Walk-Forward mit vielen kleinen Schritten (nur Lerndaten wählen aus), am Ende EIN Vergleich
// alt gegen neu auf den unbekannten Prüfdaten. Übernommen wird nur, was dort besser ist (Strenge-Regeln).
import { resolveParams, type LearnableParams, type ParamSet } from "../analysis/params";
import type { AssetKind, Candle, Horizon } from "../types";
import type { Metrics } from "./engine";
import { sessionUniverse, type CellKey, type SeriesSpec } from "./universe";
import { advanceWF, compactWF, finalizeWF, focusLabel, improvementCheck, initWF, keyOf, oosMetrics, protocolOf, type ProtocolEntry, type SavedPoint, type WFPhase, type WFResult, type WFState } from "./walkforward";

export const DURATIONS = [
  { label: "30 Min", ms: 30 * 60e3 },
  { label: "1 Std", ms: 60 * 60e3 },
  { label: "3 Std", ms: 3 * 3600e3 },
  { label: "8 Std", ms: 8 * 3600e3 },
];

export interface SessionConfig {
  id: string;
  durationMs: number;
  cells: CellKey[];
  baseVersion: number;
  paramSet: ParamSet;
  extra: { symbol: string; kind: AssetKind; yahooSymbol?: string }[];
  /** Ausgangswerte je Bereich (der Server prüft, ob sie noch gelten) */
  baseParams: Partial<Record<CellKey, LearnableParams>>;
  /** Live-Bilanz: Beginn (Unix-Sekunden) und Zahl abgeschlossener Ergebnisse – für die Live-Prüfung beim Lernen */
  live?: { start: number; done: number };
  /** Champions der Turnier-Gegner aus dem letzten Turnier (id → Stellschrauben) */
  champions?: Record<string, Record<string, number>>;
}

export interface CellOutcome {
  cell: CellKey;
  base: Metrics | null;
  cand: Metrics | null;
  accept: boolean;
  reasons: string[];
  deployed: LearnableParams | null;
  changes: string;
  series: number;
  /** Antwort des Servers nach dem Speichern */
  message?: string;
  saved?: boolean;
}

export interface SessionState {
  cfg: SessionConfig;
  elapsedMs: number;
  cellIdx: number;
  cellBudgetMs: number;
  cellElapsedMs: number;
  wf: WFState | null;
  results: CellOutcome[];
  phase: WFPhase;
  detail: string;
  /** Woran an den Elliott-Wellen gerade gearbeitet wird */
  focus: string;
  /** Zuletzt gespeicherter Stand je Bereich in dieser Sitzung */
  saved: Partial<Record<CellKey, SavedPoint>>;
  /** Schon abgelehnte Stände (Bereich|Schlüssel → Grund), damit die teuren Prüfungen nicht wiederholt laufen */
  vetoed?: Record<string, string>;
  /** Regelwerk B7: geprüfte und abgelehnte Stände */
  b7?: { checked: number; rejected: number; notes: string[] };
  /** Aktuell beste Trefferquote auf unbekannten Daten (nur Anzeige) und alter Stand */
  live?: { cell: CellKey; best: number | null; old: number | null };
  /** Turnier: Blacktrader gegen 9 Bots (5 Runden, dazwischen wird gelernt) */
  tournament?: { progress: number; text: string; round?: number; done?: boolean; failed?: string };
  status: "running" | "done" | "stopped";
}

export function newSession(cfg: SessionConfig): SessionState {
  return { cfg, elapsedMs: 0, cellIdx: 0, cellBudgetMs: 0, cellElapsedMs: 0, wf: null, results: [], phase: "load", detail: "", focus: "", saved: {}, status: "running" };
}

export interface SessionIO {
  load: (spec: SeriesSpec) => Promise<Candle[] | null>;
  onProgress: (st: SessionState) => void;
  onCellDone: (o: CellOutcome, st: SessionState) => Promise<void> | void;
  /**
   * Besserer Stand gefunden (unbekannte Daten, alle Strenge-Regeln): SOFORT speichern.
   * Rückgabe true = gespeichert → wird zur neuen Vergleichsbasis.
   */
  onImprovement?: (cell: CellKey, r: WFResult, baseParams: LearnableParams, st: SessionState) => Promise<boolean>;
  /** Kein besserer Stand: gemessenen Ausgangsstand melden (wird nur gespeichert, wenn noch keiner vorliegt) */
  onMeasured?: (cell: CellKey, base: Metrics, baseParams: LearnableParams) => void;
  /** Messprotokoll des aktiven Stands (jede bewertete Zone der Prüfdaten) */
  onProtocol?: (cell: CellKey, entries: ProtocolEntry[]) => void;
  shouldStop: () => boolean;
  now?: () => number;
  /** Länge eines Arbeitsblocks zwischen zwei Fortschrittsmeldungen */
  chunkMs?: number;
  /** Nach dem Training (nicht bei Stopp): Turnier und Auswertung */
  afterTraining?: (st: SessionState) => Promise<void>;
  /** Lernen bis zu dieser Zeit (ms) unterbrechen – das Turnier spielt dazwischen eine Runde */
  pauseAtMs?: number;
  /**
   * Live-Prüfung (Stufe 2, erst ab LIVE_LEARN_MIN abgeschlossenen Ergebnissen der Live-Bilanz): Ein neuer Stand wird nur
   * übernommen, wenn er im Zeitraum seit Beginn der Live-Bilanz nicht schlechter ist. Rückgabe: Grund für ein Nein.
   */
  liveVeto?: (cell: CellKey, baseParams: LearnableParams, cand: LearnableParams, st: SessionState) => Promise<string | null>;
  /** Regelwerk B7: Turnier-Prüfung – neuer Stand darf im Turnier nicht schlechter sein und nie ausscheiden. Rückgabe: Grund für ein Nein. */
  tournamentVeto?: (cell: CellKey, baseParams: LearnableParams, cand: LearnableParams, st: SessionState) => Promise<string | null>;
}

/** Ab so vielen abgeschlossenen Ergebnissen der Live-Bilanz prüft das Lernen zusätzlich den Live-Zeitraum */
export const LIVE_LEARN_MIN = 500;

const PHASE_ORDER: WFPhase[] = ["load", "backtest", "select", "verify", "done"];

export async function runSession(st: SessionState, io: SessionIO): Promise<SessionState> {
  const now = io.now ?? Date.now;
  const chunk = io.chunkMs ?? 1500;
  while (st.status === "running") {
    if (st.cellIdx >= st.cfg.cells.length || st.elapsedMs >= st.cfg.durationMs) break;
    if (io.pauseAtMs != null && st.elapsedMs >= io.pauseAtMs) return st;
    const cell = st.cfg.cells[st.cellIdx];
    if (!st.wf) {
      const [kind, horizon] = cell.split(":") as [AssetKind, Horizon];
      const base = resolveParams(st.cfg.paramSet, kind, horizon);
      st.wf = initWF(cell, sessionUniverse(cell, st.cfg.extra), base, { maxSteps: 1000, candidatesPerStep: 8 });
      // Restzeit gleichmäßig auf die verbleibenden Bereiche verteilen
      st.cellBudgetMs = (st.cfg.durationMs - st.elapsedMs) / (st.cfg.cells.length - st.cellIdx);
      st.cellElapsedMs = 0;
    }
    const t0 = now();
    const budget = Math.min(chunk, st.cellBudgetMs - st.cellElapsedMs, st.cfg.durationMs - st.elapsedMs);
    const finished = await advanceWF(st.wf, {
      load: io.load,
      now,
      deadline: t0 + Math.max(1, budget),
      onPhase: (p, d) => {
        st.phase = p;
        st.detail = d;
        st.focus = p === "load" ? "Kursdaten laden" : focusLabel(d.split(" · ")[1] ?? d);
      },
    });
    st.saved ??= {};
    // Lernzeit: nur das Lernen selbst zählt – Prüfen und Speichern (Live-Prüfung, Regelwerk B7) laufen obendrauf
    const spent = now() - t0;
    // Sofort speichern, sobald ein besserer Stand auf unbekannten Daten feststeht
    await trySave(st, cell, io);
    st.elapsedMs += spent;
    st.cellElapsedMs += spent;
    const base = oosMetrics(st.wf, Array.from({ length: st.wf.folds }, () => st.wf!.baseKey));
    const best = oosMetrics(st.wf, st.wf.climbers.slice(0, st.wf.folds));
    st.live = { cell, best: best?.hitRate ?? null, old: base?.hitRate ?? null };
    const stop = io.shouldStop();
    if (finished || st.cellElapsedMs >= st.cellBudgetMs || st.elapsedMs >= st.cfg.durationMs || stop) {
      st.phase = "verify";
      st.detail = "Vergleich alt gegen neu auf unbekannten Daten";
      io.onProgress(st);
      if (!st.wf.result) finalizeWF(st.wf);
      await trySave(st, cell, io);
      const r = st.wf.result;
      const series = st.wf.info.filter((x) => x && x !== "failed").length;
      const o: CellOutcome = r && series > 0
        ? { cell, base: r.base, cand: st.saved[cell]?.oos ?? r.cand, accept: !!st.saved[cell], reasons: st.saved[cell] ? [] : [...r.decision.reasons, ...(st.vetoed?.[`${cell}|${keyOf(r.deployed)}`] ? [`Nicht übernommen – ${st.vetoed[`${cell}|${keyOf(r.deployed)}`]}`] : [])], deployed: st.saved[cell]?.params ?? null, changes: r.changes, series }
        : { cell, base: null, cand: null, accept: false, reasons: [series ? "Zu wenig Zeit für einen Vergleich" : "Keine Kursdaten erreichbar"], deployed: null, changes: "keine", series };
      st.results.push(o);
      if (r && series > 0 && !st.saved[cell] && st.wf) io.onMeasured?.(cell, r.base, st.wf.pool[st.wf.baseKey].params);
      if (r && series > 0 && st.wf) {
        const wf = st.wf;
        const keys = st.saved[cell] ? wf.climbers.slice(0, wf.folds) : Array.from({ length: wf.folds }, () => wf.baseKey);
        io.onProtocol?.(cell, protocolOf(wf, keys));
      }
      st.wf = null;
      st.cellIdx++;
      await io.onCellDone(o, st);
      if (stop) st.status = "stopped";
    }
    io.onProgress(st);
  }
  if (st.status === "running" && io.afterTraining && !st.tournament?.done) await io.afterTraining(st);
  if (st.status === "running") st.status = "done";
  st.phase = "done";
  io.onProgress(st);
  return st;
}

/** Zum Speichern im Browser: ohne Backtest-Daten (werden beim Fortsetzen neu gerechnet). */
async function trySave(st: SessionState, cell: CellKey, io: SessionIO) {
  if (!st.wf || !io.onImprovement) return;
  const last = st.saved[cell];
  const r = improvementCheck(st.wf, last);
  if (!r || !r.decision.accept) return;
  const baseParams = last?.params ?? st.wf.pool[st.wf.baseKey].params;
  const vk = `${cell}|${keyOf(r.deployed)}`;
  st.vetoed ??= {};
  if (st.vetoed[vk]) return;
  const veto = (why: string) => {
    st.vetoed![vk] = why;
    st.detail = `Nicht übernommen – ${why}`;
  };
  // Live-Prüfung (Stufe 2): neuer Stand darf im Live-Zeitraum nicht schlechter sein
  if (io.liveVeto && (st.cfg.live?.done ?? 0) >= LIVE_LEARN_MIN) {
    const why = await io.liveVeto(cell, baseParams, r.deployed, st);
    if (why) return veto(why);
  }
  // Regelwerk B7: Turnier-Prüfung (nicht schlechter, nie ausgeschieden)
  if (io.tournamentVeto) {
    const why = await io.tournamentVeto(cell, baseParams, r.deployed, st);
    st.b7 ??= { checked: 0, rejected: 0, notes: [] };
    st.b7.checked++;
    if (why) {
      st.b7.rejected++;
      st.b7.notes = [...st.b7.notes, `${cell}: ${why}`].slice(-10);
      return veto(why);
    }
  }
  const ok = await io.onImprovement(cell, r, baseParams, st);
  if (ok) st.saved[cell] = { key: keyOf(r.deployed), oos: r.cand, params: r.deployed };
}

export function checkpoint(st: SessionState): SessionState {
  return { ...st, wf: st.wf ? compactWF(st.wf) : null };
}

export const phaseLabel = (p: WFPhase): string =>
  ({ load: "Daten laden", backtest: "Wellen zählen & Backtest", select: "Beste Einstellung wählen (Lerndaten)", verify: "Prüfung auf unbekannten Daten", done: "Fertig" })[p];
export { PHASE_ORDER };
