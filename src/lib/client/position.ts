"use client";
// Depot: alle offenen blauen Käufe eines Werts (Erstkauf + Nachkäufe) als EINE Position – wie bei flatex.
// Verkaufen (alles, Hälfte, Stück), Stop für die ganze Position, wartende Kauf-Orders ändern oder löschen.
// Gebucht wird erst, wenn der Nutzer es bei flatex getan hat. Gewinn je Verkauf zum Durchschnitts-Einstieg
// (anteilig auf alle Käufe verteilt – ergibt genau den Gewinn zum Ø Einstieg). Eine flatex-Order = eine Gebühr.
import { eurPerUnit } from "../fx";
import { actions, getData, type Trade } from "../store/store";
import { investedOf } from "./account";
import { tradeCurrency } from "./eur";
import { closeLongTerm, MIN_STOP_GAP, sharesExact, trancheRows } from "./longterm";

const fxOf = (t: Trade) => eurPerUnit(tradeCurrency(t)) ?? 1;

/** Offene blaue Käufe je Wert (älteste zuerst) */
export function blueGroups(trades: Trade[]): Map<string, Trade[]> {
  const m = new Map<string, Trade[]>();
  for (const t of [...trades].filter((x) => x.strategy === "longterm" && x.status !== "closed").sort((a, b) => a.openedAt - b.openedAt)) {
    const k = `${t.kind}:${t.symbol}`;
    m.set(k, [...(m.get(k) ?? []), t]);
  }
  return m;
}

export interface PositionSummary {
  /** gehaltene Stück (genau) */
  shares: number;
  /** davon noch investiert in € (gekaufte Teile, anteilig nach Teilverkäufen) */
  invested: number;
  /** Ø Einstieg in € je Stück */
  avgEur: number | null;
  /** aktueller Wert in € */
  value: number | null;
  profit: number | null;
  pct: number | null;
  /** für wartende Kauf-Orders reserviert (€) */
  reserved: number;
  invalidation?: number;
  stop: number;
}

export function positionSummary(group: Trade[], price?: number | null): PositionSummary {
  let shares = 0;
  let invested = 0;
  let reserved = 0;
  for (const t of group) {
    shares += sharesExact(t);
    invested += investedOf(t) * (t.remaining ?? 1);
    for (const x of trancheRows(t)) if (!x.filledAt) reserved += x.eur;
  }
  const fx = group.length ? fxOf(group[0]) : 1;
  const value = price != null && shares > 0 ? shares * price * fx : null;
  const profit = value != null ? value - invested : null;
  return {
    shares,
    invested,
    avgEur: shares > 0 ? invested / shares : null,
    value,
    profit,
    pct: profit != null && invested > 0 ? (profit / invested) * 100 : null,
    reserved,
    invalidation: group[0]?.lt?.invalidation,
    stop: Math.max(0, ...group.map((t) => t.stop || 0)),
  };
}

const trancheEur = (t: Trade) => trancheRows(t).reduce((a, x) => a + x.eur, 0);

/**
 * Verkauf bei flatex buchen: `qty` Stück zum Kurs `priceEur` (€ je Stück). Anteilig auf alle Käufe verteilt.
 * `dropWaiting`: wartende Kauf-Orders gleich mit löschen. Rückgabe: Meldung.
 */
export function sellPosition(group: Trade[], qty: number, priceEur: number, dropWaiting: boolean, now = Date.now()): string {
  const total = group.reduce((a, t) => a + sharesExact(t), 0);
  // Nichts zu verkaufen, nur wartende Orders löschen
  if (!(qty > 0) && dropWaiting) {
    for (const t of group) {
      const filled = (t.tranches ?? []).filter((x) => x.filledAt);
      if (!filled.length) actions.updateTrade(t.id, { status: "closed", closedAt: now, closeReason: "cancelled" });
      else actions.updateTrade(t.id, { tranches: filled, stakeEur: trancheEur({ ...t, tranches: filled }) || t.stakeEur });
    }
    return "Wartende Orders gelöscht.";
  }
  if (!(qty > 0) || !(priceEur > 0)) return "Stückzahl und Kurs eingeben.";
  if (qty > total + 1e-6) return `Du hältst nur ${total.toLocaleString("de-DE", { maximumFractionDigits: 4 })} Stück.`;
  const f = Math.min(1, qty / total);
  const all = f > 0.9999;
  let feeTaken = false;
  for (const t0 of group) {
    const t = getData().trades.find((x) => x.id === t0.id) ?? t0;
    const held = sharesExact(t);
    const price = priceEur / fxOf(t);
    if (held <= 0) {
      // nur wartende Orders: löschen, wenn gewünscht oder alles verkauft
      if (dropWaiting || all) actions.updateTrade(t.id, { status: "closed", closedAt: now, closeReason: "cancelled", lastPrice: price });
      continue;
    }
    if (all) {
      closeLongTerm({ ...t, tranches: (t.tranches ?? []).filter((x) => x.filledAt) }, price, "verkauft");
      if (feeTaken) actions.updateTrade(t.id, { sellFeeShared: true });
      feeTaken = true;
      continue;
    }
    const remaining = t.remaining ?? 1;
    const fraction = remaining * f;
    const tranches = dropWaiting ? (t.tranches ?? []).filter((x) => x.filledAt) : t.tranches;
    actions.updateTrade(t.id, {
      partials: [...(t.partials ?? []), { fraction, price, at: now, reason: "Eigener Verkauf", ...(feeTaken ? { noFee: true } : {}) }],
      remaining: remaining - fraction,
      tranches,
      ...(dropWaiting ? { stakeEur: trancheEur({ ...t, tranches }) || t.stakeEur } : {}),
    });
    feeTaken = true;
  }
  return all ? "Verkauft – Position geschlossen." : `${qty.toLocaleString("de-DE", { maximumFractionDigits: 4 })} Stück verkauft.`;
}

/** Stop-Loss für die ganze Position (bei flatex gesetzt). Muss mindestens 0,5 % unter dem Kurs liegen. */
export function setPositionStop(group: Trade[], stopEur: number, priceEur: number | null): string | null {
  if (!(stopEur > 0)) return "Stop-Kurs eingeben.";
  if (priceEur != null && stopEur >= priceEur * (1 - MIN_STOP_GAP)) return "Der Stop muss mindestens 0,5 % unter dem aktuellen Kurs liegen – sonst führt flatex ihn sofort aus.";
  let first = true;
  for (const t of group) {
    if (sharesExact(t) <= 0) continue;
    // Ein Stop bei flatex = eine Verkaufs-Order für alle Käufe → Gebühr nur einmal
    actions.updateTrade(t.id, { stop: stopEur / fxOf(t), brokerStopEur: stopEur, brokerStopNotified: undefined, sellFeeShared: first ? undefined : true });
    first = false;
  }
  return null;
}

/** Stop entfernen (bei flatex gelöscht) */
export function clearPositionStop(group: Trade[]) {
  for (const t of group) actions.updateTrade(t.id, { stop: 0, brokerStopEur: undefined, brokerStopNotified: undefined, sellFeeShared: undefined });
}

/** Wartende Kauf-Order ändern (Preis in €, Stück) oder löschen (qty 0). Reserviertes Geld passt sich an. */
export function updateWaitingOrder(t: Trade, index: number, priceEur: number, qty: number): string | null {
  const rows = trancheRows(t);
  const row = rows[index];
  if (!row || row.filledAt) return "Diese Order ist schon ausgeführt.";
  const fx = fxOf(t);
  let tranches = rows.map((x) => ({ price: x.price, filledAt: x.filledAt, qty: x.qty, eur: x.eur }));
  if (qty <= 0) tranches = tranches.filter((_, i) => i !== index);
  else {
    if (!(priceEur > 0)) return "Preis eingeben.";
    tranches[index] = { price: priceEur / fx, qty, eur: qty * priceEur, filledAt: undefined };
  }
  const anyFilled = tranches.some((x) => x.filledAt);
  if (!tranches.length || (!anyFilled && tranches.length === 0)) {
    actions.updateTrade(t.id, { status: "closed", closedAt: Date.now(), closeReason: "cancelled" });
    return null;
  }
  const stakeEur = tranches.reduce((a, x) => a + (x.eur ?? 0), 0);
  actions.updateTrade(t.id, { tranches, stakeEur, ...(anyFilled ? {} : { entry: Math.max(...tranches.map((x) => x.price)) }) });
  return null;
}
