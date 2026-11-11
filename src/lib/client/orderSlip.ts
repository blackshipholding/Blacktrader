// Order-Zettel für flatex: Stückzahl für 500 € und alle Preise in Euro (wie du sie bei flatex eingibst).
// Aktien/Rohstoffe: ganze Stück, so nah wie möglich an 500 € – bis zu 50 € darüber ist erlaubt (Wunsch des Nutzers);
// Krypto: Bruchteile (4 Nachkommastellen). Blau: 3 Teile à ca. 166,67 € (je Teil bis ca. 16,67 € darüber).
import { eurPerUnit } from "../fx";
import { ACCOUNT } from "./account";
import { tradeCurrency } from "./eur";

const fmt = (x: number) => x.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: x < 1 ? 4 : 2 });
const fmtQty = (q: number) => q.toLocaleString("de-DE", { maximumFractionDigits: 4 });

export interface SlipInput {
  kind: string;
  symbol: string;
  name: string;
  currency?: string;
  direction: "long" | "short";
  /** Preise in der Börsenwährung */
  entry: number;
  stop?: number;
  targets?: number[];
  /** Langfrist (blau): Teil-Orders in der Börsenwährung; ungültig-Grenze statt Stop */
  tranches?: number[];
  invalidation?: number;
  limit?: boolean;
  /** Einsatz in € (Standard 500 €, Nachkauf 250 €); erlaubter Aufschlag anteilig (500 € → 50 €, 250 € → 25 €) */
  budget?: number;
  /** Teile, die keine weiteren Stück bekommen dürfen (schon gekauft) */
  fixed?: boolean[];
}

export interface OrderSlip {
  fx: number;
  entryEur: number;
  stopEur?: number;
  targetEur?: number;
  /** je Order: Stück und Limit in € */
  orders: { qty: number; limitEur: number; amountEur: number }[];
  totalEur: number;
  /** 1 Stück kostet mehr als der Einsatz */
  tooExpensive: boolean;
  text: string;
}

/** Erlaubter Betrag über dem Einsatz je Trade */
export const OVER_BUDGET = 50;

/** Stückzahl: Krypto genau; sonst ganze Stück am nächsten am Budget, höchstens `cap` (Budget + erlaubter Aufschlag). */
export function qtyFor(kind: string, budget: number, priceEur: number, cap = budget + OVER_BUDGET): number {
  if (!(priceEur > 0)) return 0;
  const q = budget / priceEur;
  if (kind === "crypto") return Math.floor(q * 1e4) / 1e4;
  const lo = Math.floor(q);
  const hi = lo + 1;
  // aufrunden, wenn das näher an 500 € liegt und höchstens 50 € darüber ist (auch: 1 Stück kostet 500–550 €)
  if (hi * priceEur <= cap && (lo === 0 || hi * priceEur - budget < budget - lo * priceEur)) return hi;
  return lo;
}

/**
 * Ganze Stück über alle Teile auffüllen: solange ein weiteres Stück die Summe näher an den Einsatz bringt und
 * höchstens Einsatz + Aufschlag (500 € → 550 €) ergibt, kommt es in den Teil, mit dem die Summe am nächsten am Einsatz liegt.
 * Die 50 € gelten für den ganzen Trade, nicht je Teil (Nutzerfund T-Mobile: 3 × 1 Stück = 389,55 € statt ~500 €).
 */
export function fillShares(parts: { priceEur: number; qty: number; fixed?: boolean }[], budget: number, cap: number): number[] {
  const qty = parts.map((p) => p.qty);
  let total = parts.reduce((a, p, i) => a + qty[i] * p.priceEur, 0);
  for (let guard = 0; guard < 1000; guard++) {
    let best = -1;
    let bestDiff = Math.abs(total - budget);
    parts.forEach((p, i) => {
      if (p.fixed || !(p.priceEur > 0)) return;
      const t = total + p.priceEur;
      if (t > cap + 1e-9) return;
      const d = Math.abs(t - budget);
      if (d < bestDiff - 1e-9) (bestDiff = d), (best = i);
    });
    if (best < 0) break;
    qty[best]++;
    total += parts[best].priceEur;
  }
  return qty;
}

export function makeOrderSlip(i: SlipInput): OrderSlip {
  const fx = eurPerUnit(tradeCurrency({ symbol: i.symbol, kind: i.kind as never, currency: i.currency })) ?? 1;
  const e = (x: number) => x * fx;
  const prices = i.tranches?.length ? i.tranches : [i.entry];
  const total = i.budget ?? ACCOUNT.stake;
  const budget = total / prices.length;
  const over = (OVER_BUDGET * total) / ACCOUNT.stake;
  let orders = prices.map((p) => {
    const qty = qtyFor(i.kind, budget, e(p), budget + over / prices.length);
    return { qty, limitEur: e(p), amountEur: qty * e(p) };
  });
  // Mehrere Teile (Aktien/Rohstoffe): restliches Geld bis Einsatz + Aufschlag mit ganzen Stück auffüllen
  if (prices.length > 1 && i.kind !== "crypto") {
    const q = fillShares(orders.map((o, k) => ({ priceEur: o.limitEur, qty: o.qty, fixed: i.fixed?.[k] })), total, total + over);
    orders = orders.map((o, k) => ({ ...o, qty: q[k], amountEur: q[k] * o.limitEur }));
  }
  const stopEur = i.stop != null && i.stop > 0 ? e(i.stop) : undefined;
  const targetEur = i.targets?.[0] != null ? e(i.targets[0]) : undefined;
  const verb = i.direction === "long" ? "Kauf" : "Verkauf (Short)";
  const lines = [
    `${i.name} (${i.symbol})`,
    ...orders.map((o, k) => `${orders.length > 1 ? `Teil ${k + 1}: ` : ""}${i.limit === false && orders.length === 1 ? `${verb} ${fmtQty(o.qty)} Stück (Markt, ca. ${fmt(o.limitEur)} €)` : `Limit-${verb} ${fmtQty(o.qty)} Stück zu ${fmt(o.limitEur)} €`} = ${fmt(o.amountEur)} €`),
    stopEur != null ? `Stop-Loss: ${fmt(stopEur)} €` : i.invalidation != null ? `Kein fester Stop – ungültig unter ${fmt(e(i.invalidation))} € (Schlusskurs)` : "",
    targetEur != null ? `Ziel: ${fmt(targetEur)} €` : "",
  ].filter(Boolean);
  return { fx, entryEur: e(i.entry), stopEur, targetEur, orders, totalEur: orders.reduce((s, o) => s + o.amountEur, 0), tooExpensive: orders.some((o) => o.qty === 0), text: lines.join("\n") };
}
