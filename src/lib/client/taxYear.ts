// Steuer-Jahresübersicht (Schätzung, Österreich): KESt 27,5 % auf Kursgewinne und Dividenden, Gewinne und Verluste
// eines Kalenderjahres werden verrechnet – über Blacktrader-Trades und Buy & Hold zusammen (wie bei einem Depot).
import type { Trade } from "../store/store";
import { countsForAccount, investedOf } from "./account";
import { summarizeHolding, type Holding } from "./holdings";

export const KEST = 0.275;

export interface TaxYear {
  year: string;
  /** Kursgewinne/-verluste der Blacktrader-Trades (geschlossen) */
  trades: number;
  /** Buy & Hold: verkaufte Gewinne/Verluste */
  sold: number;
  /** Buy & Hold: Dividenden brutto */
  dividends: number;
  total: number;
  kest: number;
}

export function taxYears(trades: Trade[], holdings: Holding[]): TaxYear[] {
  const y: Record<string, TaxYear> = {};
  const row = (k: string) => (y[k] ??= { year: k, trades: 0, sold: 0, dividends: 0, total: 0, kest: 0 });
  for (const t of trades) {
    if (!countsForAccount(t) || t.status !== "closed" || t.closedAt == null || t.returnPct == null) continue;
    row(String(new Date(t.closedAt).getFullYear())).trades += (investedOf(t) * t.returnPct) / 100;
  }
  for (const h of holdings) {
    const s = summarizeHolding(h);
    for (const t of h.txs) if (t.type === "div") row(t.date.slice(0, 4)).dividends += t.price;
    for (const [k, v] of Object.entries(s.realizedByYear)) row(k).sold += v;
  }
  // realizedByYear enthält die Dividenden schon – für „verkauft“ wieder abziehen
  for (const r of Object.values(y)) {
    r.sold -= r.dividends;
    r.total = r.trades + r.sold + r.dividends;
    r.kest = Math.max(0, r.total) * KEST;
  }
  return Object.values(y).sort((a, b) => b.year.localeCompare(a.year));
}
