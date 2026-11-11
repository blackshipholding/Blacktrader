// Stand des Trainers für die Anzeige unter "Mehr → Trainer".
import { handle } from "@/lib/data/route-helpers";
import { LOCKED } from "@/lib/analysis/locked-config";
import { adminRequired } from "@/lib/trainer/auth";
import { MIN_SIGNALS_VALID, TARGET_HIT_RATE } from "@/lib/trainer/engine";
import { loadAllCells, loadSignals, loadState } from "@/lib/trainer/server";
import { liveMetrics } from "@/lib/trainer/signals";
import { storageKind } from "@/lib/trainer/storage";
import { CELL_KEYS } from "@/lib/trainer/universe";
import type { WFState } from "@/lib/trainer/walkforward";

export const dynamic = "force-dynamic";

function poolProgress(wf: WFState) {
  const runs = Object.values(wf.pool).flatMap((p) => p.runs.map((r, i) => r != null || wf.info[i] === "failed"));
  return { done: runs.filter(Boolean).length, total: runs.length };
}

export async function GET(req: Request) {
  return handle(req, async () => {
    const [s, signals, cells] = await Promise.all([loadState(), loadSignals(), loadAllCells()]);
    const job = s.job
      ? s.job.type === "train"
        ? { type: "train", cell: s.job.cell, phase: s.job.wf.stage, ...poolProgress(s.job.wf), startedAt: s.job.startedAt }
        : { type: "final", version: s.job.version, done: Object.values(s.job.results).flat().filter(Boolean).length, total: Object.values(s.job.results).flat().length, startedAt: s.job.startedAt }
      : null;
    return {
      storage: storageKind(),
      adminRequired: adminRequired(),
      target: TARGET_HIT_RATE,
      minSignals: MIN_SIGNALS_VALID,
      locked: { weights: LOCKED.weights, weightBounds: LOCKED.weightBounds, minRiskReward: LOCKED.minRiskReward },
      // Je Zelle getrennt gespeichert: aktueller und vorheriger Stand, gelernte Werte, Versionen
      cells: cells.map((r) => ({ cell: r.cell, current: r.current, previous: r.previous, updatedAt: r.updatedAt, params: r.params, version: r.version, versions: r.versions, log: r.log.slice(0, 10) })),
      live: liveMetrics(signals),
      signals: { total: signals.length, recent: signals.slice(-30).reverse() },
      log: s.log.slice(0, 150),
      history: s.history,
      finalTests: s.finalTests,
      job,
      lastRun: s.lastRun,
      lastRunNote: s.lastRunNote,
    };
  });
}
