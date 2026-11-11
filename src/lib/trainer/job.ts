// Fortsetzbarer Server-Job mit Zeitbudget (Vercel-Funktionen laufen max. 60 s).
// Je Zelle (Anlageklasse × Horizont) ein Walk-Forward-Lernschritt (walkforward.ts), danach Entscheidung
// nach den Strenge-Regeln. Die letzten 12 Monate bleiben gesperrt (einmaliger Abschlusstest je Version).
import type { AssetKind, Candle, Horizon } from "../types";
import { applyProposal, emptyRecord, recordParams, type ApplyOutcome, type CellRecord, type Proposal } from "./cells";
import { holdoutSeries, primaryRate } from "./engine";
import { addHistory, addLog, toUnit, unitMetrics, type FinalJob, type TrainerState, type TrainJob, type UnitResult } from "./state";
import { ACTIVE_CELL_KEYS, CELL_KEYS, universe, type CellKey, type SeriesSpec } from "./universe";
import { advanceWF, initWF, protocolOf, type ProtocolEntry, type WFResult, type WFState } from "./walkforward";

export type Loader = (spec: SeriesSpec) => Promise<Candle[]>;
export type Universe = (cell: CellKey) => SeriesSpec[];

/** Zugriff auf die getrennt gespeicherten Zellen (Server: Upstash/KV; Tests: Arbeitsspeicher). */
export interface CellAccess {
  get(cell: CellKey): Promise<CellRecord>;
  /** Atomar: prüfen und nur speichern, wenn besser */
  propose(cell: CellKey, p: Proposal): Promise<ApplyOutcome>;
  /** Messprotokoll (jede bewertete Zone der Prüfdaten) speichern */
  saveProtocol?(cell: CellKey, entries: ProtocolEntry[], source: string): Promise<void>;
}

export function memoryCells(): CellAccess & { records: Map<CellKey, CellRecord> } {
  const records = new Map<CellKey, CellRecord>();
  return {
    records,
    async get(cell) {
      return records.get(cell) ?? emptyRecord(cell);
    },
    async propose(cell, p) {
      const out = applyProposal(records.get(cell) ?? emptyRecord(cell), p);
      records.set(cell, out.record);
      return out;
    },
  };
}

export const SERVER_CANDIDATES = 6;
const pct = (x: number) => `${(x * 100).toFixed(1).replace(".", ",")} %`;

export async function startTrainJob(s: TrainerState, cells: CellAccess, cell?: CellKey, uni: Universe = universe): Promise<TrainJob> {
  const c = cell ?? ACTIVE_CELL_KEYS[s.rotation % ACTIVE_CELL_KEYS.length];
  if (!cell) s.rotation = (s.rotation + 1) % ACTIVE_CELL_KEYS.length;
  const base = recordParams(await cells.get(c));
  const wf = initWF(c, uni(c), base, { maxSteps: 1, candidatesPerStep: SERVER_CANDIDATES, rotation: s.round * SERVER_CANDIDATES });
  s.round++;
  const job: TrainJob = { type: "train", cell: c, startedAt: new Date().toISOString(), wf };
  s.job = job;
  return job;
}

export function startFinalJob(s: TrainerState, version: number, uni: Universe = universe): FinalJob {
  const job: FinalJob = {
    type: "final",
    version,
    startedAt: new Date().toISOString(),
    cellIdx: 0,
    specs: Object.fromEntries(CELL_KEYS.map((c) => [c, uni(c)])),
    results: Object.fromEntries(CELL_KEYS.map((c) => [c, uni(c).map(() => null)])),
    failed: [],
  };
  s.job = job;
  return job;
}

/** Ergebnis eines Walk-Forward-Laufs an die Zelle geben (speichert nur, wenn besser) und protokollieren. */
export async function submitResult(s: TrainerState, cells: CellAccess, cell: CellKey, wf: WFState, r: WFResult, source: string): Promise<string> {
  const out = await cells.propose(cell, { baseParams: wf.pool[wf.baseKey].params, base: r.base, cand: r.cand, deployed: r.deployed, source });
  addLog(s, { kind: out.saved ? "angenommen" : "abgelehnt", cell, version: out.record.version, change: r.changes, reason: `${source}: ${out.message}${out.saved ? "" : `. ${out.decision.reasons.join("; ")}`}`, base: r.base, cand: r.cand });
  const shown = out.record.current ?? r.base;
  addHistory(s, { date: new Date().toISOString(), cell, source: "backtest", hitRate: primaryRate(shown), profitFactor: shown.profitFactor, trades: shown.trades, version: out.record.version });
  return out.message;
}

class SeriesCache {
  private m = new Map<string, Candle[] | null>();
  constructor(private load: Loader) {}
  async get(spec: SeriesSpec): Promise<Candle[] | null> {
    const k = `${spec.symbol}:${spec.interval}`;
    if (!this.m.has(k)) {
      try {
        const c = await this.load(spec);
        this.m.set(k, c.length >= 300 ? c : null);
      } catch {
        this.m.set(k, null);
      }
    }
    return this.m.get(k) ?? null;
  }
}

/** Bearbeitet den laufenden Job, bis die Zeit um ist. Gibt kurze Notizen zurück. */
export async function runJob(s: TrainerState, load: Loader, deadline: number, opts: { cells: CellAccess; now?: () => number; universe?: Universe; /** Höchstens so viele Jobs abschließen (Tests) */ maxJobs?: number }): Promise<string[]> {
  const now = opts.now ?? Date.now;
  const notes: string[] = [];
  const cache = new SeriesCache(load);
  let guard = 0;
  let finished = 0;
  while (now() < deadline && guard++ < 50) {
    if (!s.job) {
      if (opts.maxJobs != null && finished >= opts.maxJobs) break;
      await startTrainJob(s, opts.cells, undefined, opts.universe);
    }
    const job = s.job!;
    const done = job.type === "train" ? await stepTrain(s, job, opts.cells, cache, deadline, now, notes) : await stepFinal(s, job, opts.cells, cache, deadline, now, notes);
    if (!done) break; // Zeit um – beim nächsten Lauf weiter
    if (!s.job) finished++;
  }
  return notes;
}

async function stepTrain(s: TrainerState, job: TrainJob, cells: CellAccess, cache: SeriesCache, deadline: number, now: () => number, notes: string[]): Promise<boolean> {
  const done = await advanceWF(job.wf, { load: (sp) => cache.get(sp), deadline, now });
  if (!done) return false;
  const ok = job.wf.info.filter((x) => x && x !== "failed").length;
  if (!job.wf.result || ok === 0) {
    notes.push(`${job.cell}: keine Kursdaten erreichbar – übersprungen`);
  } else {
    notes.push(`${job.cell}: ${await submitResult(s, cells, job.cell, job.wf, job.wf.result, "Nachtlauf")}`);
    const wf = job.wf;
    const keys = wf.result!.decision.accept ? wf.climbers.slice(0, wf.folds) : Array.from({ length: wf.folds }, () => wf.baseKey);
    await cells.saveProtocol?.(job.cell, protocolOf(wf, keys), "Nachtlauf");
  }
  s.job = null;
  return true;
}

async function stepFinal(s: TrainerState, job: FinalJob, cells: CellAccess, cache: SeriesCache, deadline: number, now: () => number, notes: string[]): Promise<boolean> {
  while (job.cellIdx < CELL_KEYS.length) {
    const cell = CELL_KEYS[job.cellIdx];
    const [kind, horizon] = cell.split(":") as [AssetKind, Horizon];
    const params = recordParams(await cells.get(cell));
    const specs = job.specs[cell] ?? [];
    const res = job.results[cell]!;
    for (let j = 0; j < specs.length; j++) {
      if (res[j] != null) continue;
      if (now() >= deadline) return false;
      const full = await cache.get(specs[j]);
      if (!full) {
        job.failed.push(`${cell} ${specs[j].symbol}`);
        res[j] = EMPTY;
        continue;
      }
      const r = holdoutSeries({ name: specs[j].symbol, kind, horizon, interval: specs[j].interval, candles: full }, params, 12, specs[j].step);
      res[j] = toUnit(r.trades, r.months);
    }
    job.cellIdx++;
  }
  const res = Object.fromEntries(CELL_KEYS.map((c) => [c, unitMetrics(job.results[c]!)]));
  s.finalTests.push({ version: job.version, date: new Date().toISOString(), cells: res });
  const summary = CELL_KEYS.filter((c) => res[c].trades).map((c) => `${c} ${pct(res[c].hitRate)} (${res[c].trades})`).join(", ") || "keine Signale";
  addLog(s, { kind: "abschlusstest", version: job.version, reason: `Einmaliger Abschlusstest auf den gesperrten letzten 12 Monaten: ${summary}` });
  notes.push("Abschlusstest fertig");
  s.job = null;
  return true;
}

const EMPTY: UnitResult = { r: [], t: [], months: 0 };
