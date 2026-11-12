// Dividenden: Betrag je Anteil und Jahr (aus Yahoo „dividendRate“, sonst Rendite × Kurs) und deine Summe netto.
// Netto = brutto − 27,5 % KESt (flatex Österreich); für Dividenden und Ausschüttungen fällt keine Gebühr an.
// Ausländische Quellensteuer (z. B. USA) ist NICHT berücksichtigt – maßgeblich ist die Abrechnung von flatex.
import { eurPerUnit } from "../fx";
import type { Holding } from "./holdings";
import { summarizeHolding } from "./holdings";
import { heldShares } from "./longterm";
import type { Trade } from "../store/store";
import type { Fundamentals } from "../types";

export const DIV_TAX = 0.275;
export const netOfTax = (gross: number) => gross * (1 - DIV_TAX);

/** Jahresdividende je Anteil in Euro (oder null, wenn keine Dividende bekannt) */
export function dividendPerShareEur(f: Fundamentals | null | undefined, priceNative?: number): number | null {
  if (!f || f.kind !== "stock") return null;
  const fx = eurPerUnit(f.currency ?? "USD") ?? 1;
  let perShare: number | undefined = f.dividendRate;
  if (!(perShare && perShare > 0) && f.dividendYield && f.dividendYield > 0 && priceNative && priceNative > 0) perShare = f.dividendYield * priceNative;
  return perShare && perShare > 0 ? perShare * fx : null;
}

/** Deine Anteile an einem Wert: Buy & Hold + offene Blacktrader-Käufe */
export function myShares(kind: string, symbol: string, holdings: Holding[], trades: Trade[]): number {
  let q = 0;
  for (const h of holdings) if (h.kind === kind && h.symbol === symbol) q += summarizeHolding(h).qty;
  for (const t of trades) {
    if (t.kind !== kind || t.symbol !== symbol || t.status !== "open" || t.direction === "short") continue;
    q += t.strategy === "longterm" ? heldShares(t) : t.shares ?? 0;
  }
  return q;
}
