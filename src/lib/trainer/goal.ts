// Ziel-Anzeige des Trainers: Stand je Anlageklasse und ob das Ziel erreicht ist.
import { primaryCount, primaryRate, TARGET_HIT_RATE, type Metrics } from "./engine";
import type { AssetKind } from "../types";

export const goalReached = (hitRate: number, target = TARGET_HIT_RATE) => hitRate >= target;

/**
 * Stand einer Anlageklasse über alle Horizonte (nach Anzahl gewichtet).
 * Standard: Zonen-Quote wie HKCM (bei älteren Messungen ohne Zonen die Trade-Quote); `trade: true` = Trade-Quote.
 */
export function classStanding(cells: { cell: string; status: { oos: Metrics } | null }[], kind: AssetKind, o: { trade?: boolean } = {}): { hitRate: number | null; trades: number } {
  let wins = 0;
  let n = 0;
  for (const c of cells) {
    if (!c.cell.startsWith(`${kind}:`) || !c.status) continue;
    const m = c.status.oos;
    const rate = o.trade ? m.hitRate : primaryRate(m);
    const cnt = o.trade ? m.trades : primaryCount(m);
    wins += rate * cnt;
    n += cnt;
  }
  return { hitRate: n > 0 ? wins / n : null, trades: n };
}

/** Füllstand des Balkens 0 … Ziel (in %, max. 100). */
export const goalProgress = (hitRate: number | null, target = TARGET_HIT_RATE) => (hitRate == null ? 0 : Math.min(100, (hitRate / target) * 100));
