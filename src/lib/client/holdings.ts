// Buy & Hold: eigene Käufe von Aktien und ETFs (unabhängig von Blacktrader). Gekauft und verkauft wird nur, wenn du es
// eingibst: Datum, Preis je Stück in Euro, Stückzahl, Gebühr (Standard 7,90 € flatex).
// KESt (Österreich): Gewinn mit gleitendem Durchschnittspreis, Spesen nicht abzugsfähig; Gewinne und Verluste eines
// Kalenderjahres werden verrechnet. Das ist eine Schätzung – maßgeblich ist die Abrechnung deiner Bank.
import type { AssetKind } from "../types";

export const HOLD_FEE = 7.9;
export const HOLD_TAX = 0.275;

export interface HoldingTx {
  id: string;
  /** Kauf, Verkauf oder Dividende (bei Dividende: price = Betrag brutto in €, qty = 1) */
  type: "buy" | "sell" | "div";
  /** Datum JJJJ-MM-TT */
  date: string;
  /** Preis je Stück in Euro */
  price: number;
  qty: number;
  fee: number;
}

export interface Holding {
  id: string;
  symbol: string;
  name: string;
  kind: AssetKind;
  yahooSymbol?: string;
  binanceSymbol?: string;
  isin?: string;
  exchange?: string;
  currency?: string;
  txs: HoldingTx[];
  /** Großer Trend laut Blacktrader (1 steigend, −1 fallend, 0 unklar) – für die Meldung bei Änderung */
  trend?: 1 | -1 | 0;
}

export interface HoldingSummary {
  qty: number;
  /** Ø Kaufpreis je Stück (gleitender Durchschnitt) */
  avg: number;
  /** Einstand der gehaltenen Stücke (ohne Gebühren) */
  cost: number;
  /** Bereits verkaufter Gewinn/Verlust (ohne Gebühren) */
  realized: number;
  fees: number;
  /** Geschätzte KESt auf verkaufte Gewinne (je Jahr verrechnet) */
  tax: number;
  /** Realisierter Gewinn je Kalenderjahr inkl. Dividenden (für die Verrechnung über alle Werte) */
  realizedByYear: Record<string, number>;
  /** Dividenden brutto */
  dividends: number;
  invested: number;
}

const ORDER = { buy: 0, div: 1, sell: 2 } as const;
const byDate = (a: HoldingTx, b: HoldingTx) => a.date.localeCompare(b.date) || ORDER[a.type] - ORDER[b.type];

export function summarizeHolding(h: Pick<Holding, "txs">): HoldingSummary {
  let qty = 0;
  let cost = 0;
  let realized = 0;
  let fees = 0;
  let invested = 0;
  const realizedByYear: Record<string, number> = {};
  let dividends = 0;
  for (const t of [...h.txs].sort(byDate)) {
    fees += t.fee;
    if (t.type === "div") {
      // Dividenden sind in Österreich KESt-pflichtig und mit Kursverlusten verrechenbar
      dividends += t.price;
      const y = t.date.slice(0, 4);
      realizedByYear[y] = (realizedByYear[y] ?? 0) + t.price;
      continue;
    }
    if (t.type === "buy") {
      qty += t.qty;
      cost += t.qty * t.price;
      invested += t.qty * t.price + t.fee;
    } else {
      const q = Math.min(t.qty, qty);
      if (q <= 0) continue;
      const avg = cost / qty;
      const g = (t.price - avg) * q;
      realized += g;
      const y = t.date.slice(0, 4);
      realizedByYear[y] = (realizedByYear[y] ?? 0) + g;
      cost -= avg * q;
      qty -= q;
      if (qty < 1e-9) {
        qty = 0;
        cost = 0;
      }
    }
  }
  const tax = Object.values(realizedByYear).reduce((s, g) => s + Math.max(0, g) * HOLD_TAX, 0);
  return { qty, avg: qty > 0 ? cost / qty : 0, cost, realized, fees, tax, realizedByYear, invested, dividends };
}

/** KESt über alle Werte: Gewinne und Verluste eines Jahres werden verrechnet. */
export function totalTax(summaries: HoldingSummary[]): number {
  const y: Record<string, number> = {};
  for (const s of summaries) for (const [k, v] of Object.entries(s.realizedByYear)) y[k] = (y[k] ?? 0) + v;
  return Object.values(y).reduce((s, g) => s + Math.max(0, g) * HOLD_TAX, 0);
}
