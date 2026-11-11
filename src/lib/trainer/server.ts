// Serverseitiger Ablauf des Trainers (nächtlicher Cron und manueller Schritt).
import { analyze } from "../analysis/analyze";
import { resolveParams } from "../analysis/params";
import { SCAN_GROUPS } from "../client/presets";
import { binanceCandles } from "../data/binance";
import { yahooCandles, yahooHistory } from "../data/yahoo";
import { HORIZON_DEFAULT_INTERVAL, type Candle, type Horizon, type ResolvedAsset } from "../types";
import { assembleParamSet, cellStorageKey, diffFromDefault, emptyRecord, type CellRecord } from "./cells";
import { loadAllCells, serverCells } from "./cellStore";
import { runJob, startFinalJob } from "./job";
import { addHistory, initialState, type TrainerState } from "./state";
import { evaluateSignal, liveMetrics, MAX_SIGNALS, recordFromAnalysis, type SignalRecord } from "./signals";
import { acquireLock, getJson, releaseLock, setJson, storageKind } from "./storage";
import { CELL_KEYS, type CellKey, type SeriesSpec } from "./universe";

const STATE_KEY = "trainer:state:v1";
const SIGNALS_KEY = "trainer:signals:v1";
const LOCK_KEY = "trainer:lock";

export async function loadState(): Promise<TrainerState> {
  const s = (await getJson<TrainerState & { schema: number }>(STATE_KEY)) ?? initialState();
  if (s.schema !== 2) await migrateLegacy(s);
  return s;
}

/** Schema 1 (ein gemeinsamer Schlüssel) → getrennte Zellen. Läuft einmal; vorhandene Zellen werden nie überschrieben. */
async function migrateLegacy(s: TrainerState & { schema: number }) {
  const legacy = s.versions?.find((v) => v.id === s.current)?.params ?? {};
  for (const c of CELL_KEYS) {
    const key = cellStorageKey(c);
    if (await getJson<CellRecord>(key)) continue;
    const st = s.cells?.[c];
    if (!legacy[c] && !st) continue;
    const r = emptyRecord(c);
    r.params = legacy[c] ?? {};
    r.current = st?.oos ?? null;
    r.rev = 1;
    r.updatedAt = st?.updated ?? new Date().toISOString();
    await setJson(key, r);
  }
  delete s.versions;
  delete s.current;
  delete s.cells;
  (s as { schema: number }).schema = 2;
}

export { loadCell, loadAllCells, withCellLock, serverCells, rollbackCell } from "./cellStore";
export async function currentParamSet() {
  return assembleParamSet(await loadAllCells());
}
export const saveState = (s: TrainerState) => setJson(STATE_KEY, s);
export async function loadSignals(): Promise<SignalRecord[]> {
  return (await getJson<SignalRecord[]>(SIGNALS_KEY)) ?? [];
}
const saveSignals = (l: SignalRecord[]) => setJson(SIGNALS_KEY, l.slice(-MAX_SIGNALS));

/** Historie für das Training (Yahoo; Krypto als BTC-USD usw.). */
export const trainingLoader = async (spec: SeriesSpec): Promise<Candle[]> => (await yahooHistory(spec.symbol, spec.interval, spec.days)).candles;

async function liveCandles(a: ResolvedAsset, h: Horizon): Promise<Candle[]> {
  const iv = HORIZON_DEFAULT_INTERVAL[h];
  if (a.binanceSymbol) {
    try {
      return await binanceCandles(a.binanceSymbol, iv);
    } catch {
      /* Yahoo als Ersatz */
    }
  }
  return yahooCandles(a.yahooSymbol ?? a.symbol, iv);
}

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>, deadline: number) {
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length && Date.now() < deadline) await fn(items[i++]);
    }),
  );
}

/** Signal-Protokoll: offene Signale auswerten und neue Signale mit den aktuellen Werten erfassen. */
export async function updateSignalLog(s: TrainerState, deadline: number): Promise<{ added: number; closed: number; list: SignalRecord[] }> {
  const list = await loadSignals();
  const version = await currentParamSet();
  let added = 0;
  let closed = 0;
  const jobs = SCAN_GROUPS.flatMap((g) => g.assets.flatMap((a) => (["short", "medium", "long"] as Horizon[]).map((h) => ({ a, h }))));
  await pool(
    jobs,
    6,
    async ({ a, h }) => {
      let candles: Candle[];
      try {
        candles = await liveCandles(a, h);
      } catch {
        return;
      }
      if (candles.length < 50) return;
      // 1) Offene Signale dieses Werts auswerten (nur Kerzen nach dem Signal)
      for (let k = 0; k < list.length; k++) {
        const r = list[k];
        if (r.symbol !== a.symbol || r.horizon !== h || !(r.status === "wartet" || r.status === "offen")) continue;
        if (candles[0].time > r.time) continue; // Kerzen reichen nicht so weit zurück
        const next = evaluateSignal(r, candles);
        if (next.status !== r.status && (next.status === "gewonnen" || next.status === "verloren" || next.status === "verfallen")) closed++;
        list[k] = next;
      }
      // 2) Neues Signal erfassen (nur, wenn für diesen Wert/Horizont keines mehr läuft)
      if (list.some((r) => r.symbol === a.symbol && r.horizon === h && (r.status === "wartet" || r.status === "offen"))) return;
      const params = resolveParams(version.params, a.kind, h);
      const res = analyze({ symbol: a.symbol, name: a.name, candles, horizon: h, interval: HORIZON_DEFAULT_INTERVAL[h], kind: a.kind, params, currency: a.currency });
      if (!res) return;
      const rec = recordFromAnalysis(res, a, version.version, diffFromDefault(params));
      if (rec && !list.some((r) => r.id === rec.id)) {
        list.push(rec);
        added++;
      }
    },
    deadline,
  );
  await saveSignals(list);
  return { added, closed, list };
}

export interface CycleResult {
  ok: boolean;
  note: string;
  storage: string;
}

/** Ein Durchlauf: Signal-Protokoll, dann Lernschritte bis zum Zeitbudget. */
export async function runCycle(opts: { budgetMs: number; withSignals: boolean; final?: boolean }): Promise<CycleResult> {
  const start = Date.now();
  if (!(await acquireLock(LOCK_KEY, Math.ceil(opts.budgetMs / 1000) + 30))) return { ok: false, note: "Der Trainer läuft gerade schon.", storage: storageKind() };
  try {
    const s = await loadState();
    const notes: string[] = [];
    if (opts.final) {
      const stamp = (await currentParamSet()).version;
      if (s.finalTests.some((f) => f.version === stamp)) return { ok: false, note: "Dieser Stand wurde bereits einmal abschließend getestet.", storage: storageKind() };
      if (!(s.job?.type === "final" && s.job.version === stamp)) startFinalJob(s, stamp);
    }
    if (opts.withSignals) {
      const r = await updateSignalLog(s, start + Math.min(25_000, opts.budgetMs * 0.4));
      notes.push(`Signal-Protokoll: ${r.added} neu, ${r.closed} abgeschlossen`);
      const live = liveMetrics(r.list);
      for (const c of CELL_KEYS) {
        const m = live[c];
        if (m && m.trades > 0) addHistory(s, { date: new Date().toISOString(), cell: c, source: "live", hitRate: m.hitRate, profitFactor: m.profitFactor, trades: m.trades, version: 0 });
      }
    }
    notes.push(...(await runJob(s, trainingLoader, start + opts.budgetMs, { cells: serverCells })));
    s.lastRun = new Date().toISOString();
    s.lastRunNote = (notes.length > 6 ? [...notes.slice(0, 1), `… ${notes.length - 4} weitere …`, ...notes.slice(-3)] : notes).join(" · ") || "Lernschritt fortgesetzt";
    await saveState(s);
    return { ok: true, note: s.lastRunNote, storage: storageKind() };
  } finally {
    await releaseLock(LOCK_KEY);
  }
}
