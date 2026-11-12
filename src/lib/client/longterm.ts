"use client";
// Langfrist-Positionen (blau) als Papier-Trades: Einstieg in drei Teilen, kein fester Stop.
// Teilausstieg / Stop / Ausstieg NUR, wenn Blacktrader eine geänderte Zählung meldet (assessLongTerm) –
// und erst, wenn der Nutzer den Vorschlag bei flatex umgesetzt und bestätigt hat (wie bei flatex selbst).
import { fillShares, makeOrderSlip, OVER_SHARE } from "./orderSlip";
import { toEurReturn, tradeCurrency } from "./eur";
import { eurPerUnit } from "../fx";
import { analyzeElliott } from "../analysis/elliott";
import { assessLongTerm, blendedReturn, protectDue, trailStop, type LongTermAction, type LongTermZone } from "../analysis/longterm";
import { getStopParams } from "./stopParams";
import { money } from "../analysis/persona";
import { actions, getData, type LongTermProposal, type Trade } from "../store/store";
import { ACCOUNT, ADD, canAfford, freeCash, noMoney, noTwice } from "./account";
import { nachkaufState, openPositions } from "./nachkauf";
import type { Candle, Horizon, Interval, ResolvedAsset } from "../types";

type Asset = Pick<ResolvedAsset, "symbol" | "name" | "kind" | "binanceSymbol" | "yahooSymbol" | "currency" | "isin" | "exchange" | "coingeckoId">;

/** Teil-Orders über dem aktuellen Kurs werden sofort zum Marktpreis ausgeführt → mit dem Kurs rechnen */
export const effectiveLevels = (levels: number[], price: number) => levels.map((p) => (price > 0 && price < p ? price : p));

/** Kauf so eintragen, wie flatex ihn ausgeführt hat (Preis in €, Stück). Der alte Stand bleibt in `corrections`. */
export function correctFill(t: Trade, index: number, priceEur: number, qty: number): string | null {
  const tr = t.tranches ?? [];
  if (!tr[index]?.filledAt) return "Dieser Teil ist noch nicht gekauft.";
  if (!(priceEur > 0) || !(qty > 0)) return "Kaufpreis und Stück eingeben.";
  const fx = eurPerUnit(tradeCurrency(t)) ?? 1;
  const tranches = tr.map((x, i) => (i === index ? { ...x, price: priceEur / fx, qty, eur: qty * priceEur } : x));
  const filled = tranches.filter((x) => x.filledAt);
  const entry = filled.every((x) => x.qty) ? filled.reduce((a, x) => a + x.price * x.qty!, 0) / filled.reduce((a, x) => a + x.qty!, 0) : t.entry;
  const stakeEur = tranches.reduce((a, x) => a + (x.eur ?? 0), 0) || t.stakeEur;
  actions.updateTrade(t.id, { tranches, entry, stakeEur, corrections: [...(t.corrections ?? []), { at: Date.now(), tranches: tr, stakeEur: t.stakeEur, entry: t.entry }] });
  return null;
}

export const openLongTerm = (symbol: string) => getData().trades.find((t) => t.strategy === "longterm" && t.status !== "closed" && t.symbol === symbol);

/**
 * Langfristigen Einstieg übernehmen: drei wartende Teil-Orders im Bereich (500 €).
 * `nachkauf`: Wert liegt schon im Depot → nur ein weiterer blauer Bereich, eine Order zu 250 € an der Oberkante
 * (höchstens 4 Nachkäufe, siehe nachkauf.ts).
 */
export function openLongTermTrade(asset: Asset, z: LongTermZone, horizon: Horizon, interval: Interval, price: number, opts: { nachkauf?: boolean } = {}): boolean {
  const nk = opts.nachkauf === true;
  if (nk ? !nachkaufState(asset.symbol, z).allowed : openPositions(asset.symbol).length > 0) {
    if (!nk) noTwice();
    return false;
  }
  // Liegt der Kurs schon unter einem Teil, kauft flatex diesen sofort zum Marktpreis – Zettel und Buchung mit dem Kurs
  const levels = effectiveLevels(nk ? [z.zoneTop] : [...z.tranches], price);
  const slip = makeOrderSlip({ kind: asset.kind, symbol: asset.symbol, name: asset.name, currency: asset.currency, direction: "long", entry: z.zoneTop, tranches: levels, budget: nk ? ADD.stake : undefined });
  const amount = slip.totalEur > 0 ? slip.totalEur : undefined;
  if (!canAfford(getData().trades, getData().accountResets, amount)) {
    noMoney(freeCash(getData().trades, getData().accountResets));
    return false;
  }
  const now = Date.now();
  const tranches = levels.map((p, i) => ({ price: p, filledAt: price <= p ? now : undefined, qty: slip.orders[i]?.qty, eur: slip.orders[i]?.amountEur }));
  const filled = tranches.filter((t) => t.filledAt);
  actions.addTrade({
    strategy: "longterm",
    status: filled.length ? "open" : "pending",
    orderType: "limit",
    symbol: asset.symbol,
    name: asset.name,
    kind: asset.kind,
    binanceSymbol: asset.binanceSymbol,
    yahooSymbol: asset.yahooSymbol,
    currency: asset.currency,
    direction: "long",
    horizon,
    interval,
    entry: filled.length ? Math.min(price, ...filled.map((t) => t.price)) : levels[0],
    stop: 0,
    targets: [...z.targets],
    openedAt: now,
    nachkauf: nk || undefined,
    reason: nk ? `Nachkauf (${ADD.stake.toLocaleString("de-DE")} €) im neuen blauen Bereich ${money(z.zoneTop, asset.currency)} – ${money(z.zoneBottom, asset.currency)}. Kein fester Stop – ungültig bei Schlusskurs unter ${money(z.invalidation, asset.currency)}.` : `Langfristiger Einstieg in drei Teilen ${money(z.zoneTop, asset.currency)} – ${money(z.zoneBottom, asset.currency)}. Kein fester Stop – ungültig bei Schlusskurs unter ${money(z.invalidation, asset.currency)}. Teilausstieg oder Stop nur, wenn sich die Wellenzählung ändert.`,
    score: 0,
    signal: "buy",
    pattern: "Langfrist-Einstiegsbereich",
    lastPrice: price,
    lt: { zoneTop: z.zoneTop, zoneBottom: z.zoneBottom, invalidation: z.invalidation, targets: [...z.targets], key: z.key, highTime: z.high.time },
    tranches,
    partials: [],
    remaining: 1,
    source: "manual",
    shares: slip.orders.reduce((s, o) => s + o.qty, 0),
    stakeEur: amount,
  });
  return true;
}

export const filledTranches = (t: Trade) => (t.tranches ?? []).filter((x) => x.filledAt);
/** Durchschnittlicher Einstieg der gekauften Teile – gewichtet nach Stückzahl (wenn bekannt) */
export const avgEntry = (t: Trade) => {
  const f = filledTranches(t);
  if (!f.length) return t.entry;
  if (f.every((x) => x.qty != null && x.qty > 0)) return f.reduce((s, x) => s + x.price * x.qty!, 0) / f.reduce((s, x) => s + x.qty!, 0);
  return f.reduce((s, x) => s + x.price, 0) / f.length;
};

/** Laufende Kurse: Teil-Orders ausführen, gesetzten Stop prüfen. Gibt eine Meldung zurück, wenn etwas passiert. */
export function trackLongTerm(t: Trade, price: number): string | null {
  if (t.strategy !== "longterm" || t.status === "closed") return null;
  const now = Date.now();
  let changed = false;
  const tranches = (t.tranches ?? []).map((x) => {
    // Wartende Teil-Orders liegen bei flatex als Limit-Order – sie werden ausgeführt, bis der Nutzer sie löscht
    if (!x.filledAt && price <= x.price) {
      changed = true;
      return { ...x, filledAt: now, price: Math.min(x.price, price) };
    }
    return x;
  });
  let msg: string | null = null;
  if (changed) {
    const n = tranches.filter((x) => x.filledAt).length;
    const f = tranches.filter((x) => x.filledAt);
    actions.updateTrade(t.id, { tranches, status: "open", entry: f.reduce((s, x) => s + x.price, 0) / f.length, lastPrice: price });
    msg = `Teil ${n} von 3 gekauft bei ${money(price, tradeCurrency(t))}.`;
  }
  if (t.status === "open" && t.stop > 0 && price <= t.stop) {
    closeLongTerm({ ...t, tranches }, price, "stop");
    return `Stop bei ${money(t.stop, tradeCurrency(t))} erreicht – Rest verkauft.`;
  }
  return msg;
}

export function closeLongTerm(t: Trade, price: number, reason: Trade["closeReason"]) {
  const filled = filledTranches(t);
  if (!filled.length) {
    actions.updateTrade(t.id, { status: "closed", closedAt: Date.now(), closeReason: "cancelled", lastPrice: price });
    return;
  }
  const entry = avgEntry(t);
  actions.updateTrade(t.id, { status: "closed", exit: price, closedAt: Date.now(), closeReason: reason, returnPct: toEurReturn(blendedReturn(entry, t.partials ?? [], price), t), fxExit: eurPerUnit(tradeCurrency(t)) ?? undefined, lastPrice: price, remaining: 0 });
}

/** Meldung von Blacktrader auf die Position anwenden (Papier-Trade folgt der Meldung). */
export function applyLongTermAction(t: Trade, a: LongTermAction, price: number): string {
  const filled = filledTranches(t).length;
  const base = { lastActionKey: a.key, lastActionText: a.reason };
  if (a.kind === "ausstieg" || !filled) {
    actions.updateTrade(t.id, base);
    closeLongTerm({ ...t, ...base }, price, a.kind === "ausstieg" ? "invalidiert" : "zaehlung");
    return filled ? a.reason : "Zählung geändert – wartende Teil-Orders gestrichen.";
  }
  if (a.kind === "teilausstieg") {
    const remaining = t.remaining ?? 1;
    const fraction = remaining * a.fraction;
    actions.updateTrade(t.id, { ...base, partials: [...(t.partials ?? []), { fraction, price, at: Date.now(), reason: a.reason }], remaining: remaining - fraction, stop: a.stop, tranches: (t.tranches ?? []).filter((x) => x.filledAt) });
    return `${a.reason} Verkauft bei ${money(price, tradeCurrency(t))}, Stop ${money(a.stop, tradeCurrency(t))}.`;
  }
  actions.updateTrade(t.id, { ...base, stop: a.stop, tranches: (t.tranches ?? []).filter((x) => x.filledAt) });
  return `${a.reason} Stop ${money(a.stop, tradeCurrency(t))}.`;
}

/** Bewertung mit Kerzen der Positions-Kerzengröße (Wellenzählung auf denselben Kerzen).
 * Blacktrader handelt NICHT mehr selbst: Er macht einen Vorschlag (Order-Zettel für flatex), der erst nach
 * „Bei flatex erledigt“ gebucht wird. Unbestätigt → Erinnerung am nächsten Tag. */
export function checkLongTermWithCandles(t: Trade, candles: Candle[]): string | null {
  if (t.strategy !== "longterm" || t.status === "closed" || !t.lt || candles.length < 60) return null;
  const elliott = analyzeElliott(candles.slice(-600));
  const a = assessLongTerm({ direction: "long", entry: avgEntry(t), invalidation: t.lt.invalidation, stop: t.stop || undefined, remaining: t.remaining ?? 1, lastActionKey: t.lastActionKey }, candles, elliott);
  const price = candles[candles.length - 1].close;
  // Geänderte Zählung hat Vorrang; sonst Shipmaster 0.2 (Gewinn-Schutz), wenn kein anderer Vorschlag offen ist
  const act = a ?? (t.proposal ? null : shipmasterProtect(t, price) ?? shipmasterTrail(t, candles));
  if (act && act.key !== t.proposal?.key) {
    const p = makeProposal(act, price);
    actions.updateTrade(t.id, { proposal: p });
    return `Vorschlag: ${proposalSteps({ ...t, proposal: p }).join(" · ")}. Bei flatex umsetzen und im Depot bestätigen.`;
  }
  if (t.proposal && !t.proposal.reminded && Date.now() - t.proposal.at > 20 * 3600e3) {
    actions.updateTrade(t.id, { proposal: { ...t.proposal, reminded: true } });
    return `Erinnerung – noch offen: ${proposalSteps(t).join(" · ")}. Im Depot bestätigen oder ablehnen.`;
  }
  return null;
}

/**
 * Shipmaster 0.2 – Gewinn-Schutz je Kauf: Kurs über der Oberkante seiner Zone und ≥ +20 % über seinem Ø Einstieg →
 * Vorschlag „Stop-Loss auf die Oberkante, wartende Teile löschen“ (gebucht erst nach „Bei flatex erledigt“).
 * Einmal je Kauf: erledigt oder abgelehnt → kommt nicht wieder (lastActionKey).
 */
export function shipmasterProtect(t: Trade, price: number): LongTermAction | null {
  if (t.strategy !== "longterm" || t.status === "closed" || !t.lt || !filledTranches(t).length) return null;
  const key = `ship02:${t.lt.key}`;
  if (t.lastActionKey === key || t.proposal?.key === key) return null;
  if (t.stop > 0 && t.stop >= t.lt.zoneTop * 0.999) return null; // Stop liegt schon mindestens auf der Oberkante
  const avg = avgEntry(t);
  const sp = getStopParams();
  if (!protectDue(price, avg, t.lt.zoneTop, sp.gain)) return null;
  const up = ((price - avg) / avg) * 100;
  return {
    kind: "stop",
    key,
    stop: t.lt.zoneTop,
    reason: `Shipmaster 0.2: Kurs ${up.toFixed(0)} % über deinem Einstieg und über der blauen Zone – Stop-Loss auf die Oberkante ${money(t.lt.zoneTop, tradeCurrency(t))} sichert den Gewinn (ab +${Math.round(sp.gain * 100)} %).`,
  };
}

/**
 * Shipmaster 0.2 – Stop nachziehen oder zurückschieben (lernbar, enger Rahmen): nur wenn der Stop schon bei flatex liegt, nur
 * einmal je FERTIGER Wochenkerze, aus dem tiefsten Tief der letzten Wochenkerzen (Dochte zählen), nur bei Mindestschritt,
 * nie unter die Oberkante der Zone und immer unter dem Kurs. Als Vorschlag – gebucht erst nach „Bei flatex erledigt“.
 */
export function shipmasterTrail(t: Trade, candles: Candle[], now = Date.now()): LongTermAction | null {
  const sp = getStopParams();
  if (sp.trailWeeks <= 0 || t.strategy !== "longterm" || t.status === "closed" || !t.lt || !(t.stop > 0) || t.proposal || t.interval !== "1w") return null;
  const done = candles.filter((c) => c.time * 1000 + 7 * 86400e3 <= now);
  const last = done[done.length - 1];
  if (!last || (t.lastTrailAt != null && t.lastTrailAt >= last.time)) return null; // diese Wochenkerze schon geprüft
  const price = candles[candles.length - 1].close;
  const ns = trailStop(t.stop, t.lt.zoneTop, done.slice(-sp.trailWeeks).map((c) => c.low), price, sp);
  actions.updateTrade(t.id, { lastTrailAt: last.time });
  if (ns === t.stop || ns < t.lt.zoneTop) return null;
  const cur = tradeCurrency(t);
  return {
    kind: "stop",
    key: `trail:${t.lt.key}:${last.time}`,
    stop: ns,
    reason: `Shipmaster 0.2 – Wochenkerze fertig: Stop ${ns > t.stop ? "nachziehen" : "zurück Richtung Oberkante"} von ${money(t.stop, cur)} auf ${money(ns, cur)} (nie unter die Oberkante ${money(t.lt.zoneTop, cur)}).`,
  };
}

/** Abstand, den ein Stop-Loss bei flatex mindestens unter dem Kurs haben muss (sonst sofort ausgeführt) */
export const MIN_STOP_GAP = 0.005;

/** Aus einer Meldung einen Vorschlag machen. Läge der Stop nicht sicher unter dem Kurs, geht das bei flatex nicht → jetzt verkaufen. */
export function makeProposal(a: LongTermAction, price: number, now = Date.now()): LongTermProposal {
  if (a.kind !== "ausstieg" && a.stop >= price * (1 - MIN_STOP_GAP))
    return { key: a.key, kind: "ausstieg", reason: `${a.reason} Der Stop läge über dem Kurs – bei flatex nicht möglich, deshalb jetzt verkaufen.`, price, at: now };
  if (a.kind === "teilausstieg") return { key: a.key, kind: a.kind, reason: a.reason, fraction: a.fraction, stop: a.stop, price, at: now };
  if (a.kind === "stop") return { key: a.key, kind: a.kind, reason: a.reason, stop: a.stop, price, at: now };
  return { key: a.key, kind: "ausstieg", reason: a.reason, price, at: now };
}

/** Gehaltene Stück (gekaufte Teile, abzüglich Teilverkäufe) */
/** Stückzahl je Teil (gespeichert oder wie auf dem Order-Zettel nachgerechnet) und Betrag in € */
export function trancheRows(t: Trade): { price: number; filledAt?: number; qty: number; eur: number }[] {
  const tr = t.tranches ?? [];
  const slip = tr.some((x) => x.qty == null || x.eur == null) && tr.length ? makeOrderSlip({ kind: t.kind, symbol: t.symbol, name: t.name, currency: t.currency, direction: "long", entry: tr[0].price, tranches: tr.map((x) => x.price), budget: t.nachkauf ? ADD.stake : 500, fixed: tr.map((x) => !!x.filledAt) }) : null;
  return tr.map((x, i) => ({ ...x, qty: x.qty ?? slip?.orders[i]?.qty ?? 0, eur: x.eur ?? slip?.orders[i]?.amountEur ?? 0 }));
}

/**
 * Wartende Teile einer blauen Position (Aktien/Rohstoffe) mit ganzen Stück bis ~500 € (höchstens 550 €) auffüllen –
 * die 50 € gelten für den ganzen Trade. Gekaufte Teile bleiben, wie sie sind. Rückgabe: neue Teile + Hinweis, sonst null.
 */
export function refillWaiting(t: Trade): { tranches: NonNullable<Trade["tranches"]>; stakeEur: number; note: string } | null {
  if (t.strategy !== "longterm" || t.status === "closed" || t.kind === "crypto") return null;
  const rows = trancheRows(t);
  if (rows.length < 2 || rows.every((x) => x.filledAt) || rows.some((x) => !(x.qty > 0) || !(x.eur > 0))) return null;
  const budget = t.nachkauf ? ADD.stake : ACCOUNT.stake;
  const q = fillShares(rows.map((x) => ({ priceEur: x.eur / x.qty, qty: x.qty, fixed: !!x.filledAt })), budget, budget * (1 + OVER_SHARE));
  if (q.every((n, i) => n === rows[i].qty)) return null;
  const tranches = rows.map((x, i) => ({ price: x.price, filledAt: x.filledAt, qty: q[i], eur: q[i] * (x.eur / x.qty) }));
  const no = (i: number) => `Teil ${i + 1}`;
  const changed = rows.flatMap((x, i) => (q[i] !== x.qty ? [`${no(i)} jetzt ${q[i]} Stück (${tranches[i].eur.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €)`] : []));
  return {
    tranches,
    stakeEur: tranches.reduce((a, x) => a + x.eur, 0),
    note: `Neu berechnet (bis 10 % über dem Betrag): ${changed.join(", ")} – bitte die wartende Order bei flatex anpassen.`,
  };
}

/** Einmalig: ältere blaue Positionen nach der neuen Stück-Regel auffüllen (Nutzer-Wunsch „Back-Fix“) */
export function backfillShares() {
  const KEY = "v4-fill550";
  const d = getData();
  if (d.migrations.includes(KEY)) return;
  for (const t of d.trades) {
    const r = refillWaiting(t);
    if (r) actions.updateTrade(t.id, { tranches: r.tranches, stakeEur: r.stakeEur, lastActionText: r.note });
  }
  actions.addMigration(KEY);
}

/**
 * Shipmaster 0.1 für bestehende Käufe: wartende Teile so neu berechnen, dass die Position 10 % vom Kontostand ergibt
 * (Nachkauf: 2 %). Gekaufte Teile bleiben. Rückgabe: neue Teile + Hinweis „bitte bei flatex anpassen“, sonst null.
 */
export function reshipWaiting(t: Trade, budget: number): { tranches: NonNullable<Trade["tranches"]>; stakeEur: number; note: string } | null {
  if (t.strategy !== "longterm" || t.status === "closed" || !(budget > 0)) return null;
  const rows = trancheRows(t);
  const waiting = rows.map((x, i) => (x.filledAt ? -1 : i)).filter((i) => i >= 0);
  if (!waiting.length || rows.some((x) => !(x.eur > 0) && !!x.filledAt)) return null;
  const unit = rows.map((x) => (x.qty > 0 && x.eur > 0 ? x.eur / x.qty : NaN));
  if (waiting.some((i) => !(unit[i] > 0))) return null;
  const filledEur = rows.reduce((a, x) => a + (x.filledAt ? x.eur : 0), 0);
  const rest = budget - filledEur;
  if (rest <= 0) return null;
  const per = rest / waiting.length;
  let q = rows.map((x, i) => (x.filledAt ? x.qty : t.kind === "crypto" ? Math.floor((per / unit[i]) * 1e4) / 1e4 : Math.floor(per / unit[i])));
  if (t.kind !== "crypto") q = fillShares(rows.map((x, i) => ({ priceEur: unit[i] || 0, qty: q[i], fixed: !!x.filledAt })), budget, budget * (1 + OVER_SHARE));
  if (q.every((n, i) => n === rows[i].qty)) return null;
  const tranches = rows.map((x, i) => ({ price: x.price, filledAt: x.filledAt, qty: q[i], eur: x.filledAt ? x.eur : q[i] * unit[i] }));
  const fmt = (n: number) => n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const changed = rows.flatMap((x, i) => (q[i] !== x.qty ? [`Teil ${i + 1} jetzt ${q[i].toLocaleString("de-DE", { maximumFractionDigits: 4 })} Stück (${fmt(tranches[i].eur)} €)`] : []));
  return { tranches, stakeEur: tranches.reduce((a, x) => a + x.eur, 0), note: `Shipmaster 0.1: ${changed.join(", ")} – bitte die wartende Order bei flatex anpassen.` };
}

/** Einmalig beim Update auf Shipmaster 0.1: alter Standard 8.000 € → 10.000 €; wartende blaue Teile auf 10 % (Nachkauf 2 %) */
export function migrateShipmaster() {
  const KEY = "v5-shipmaster-0.1";
  const d = getData();
  if (d.migrations.includes(KEY)) return;
  if (d.settings.capitalEur === 8000) actions.setSettings({ capitalEur: 10000 });
  for (const t of getData().trades) {
    const r = reshipWaiting(t, t.nachkauf ? ADD.stake : ACCOUNT.stake);
    if (r) actions.updateTrade(t.id, { tranches: r.tranches, stakeEur: r.stakeEur, lastActionText: r.note });
  }
  actions.addMigration(KEY);
}

/** Gehaltene Stück (genau, ohne Runden): gekaufte Teile × noch gehaltener Anteil */
export function sharesExact(t: Trade): number {
  return trancheRows(t).reduce((a, x) => a + (x.filledAt ? x.qty : 0), 0) * (t.remaining ?? 1);
}

/** Gehaltene Stück (gekaufte Teile, abzüglich Teilverkäufe) */
export function heldShares(t: Trade): number {
  const q = sharesExact(t);
  return t.kind === "crypto" ? Math.floor(q * 1e4 + 1e-6) / 1e4 : Math.round(q);
}

/** Die Schritte bei flatex in Worten */
export function proposalSteps(t: Trade): string[] {
  const p = t.proposal;
  if (!p) return [];
  const fx = eurPerUnit(tradeCurrency(t)) ?? 1;
  const eur = (x: number) => `${(x * fx).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
  const held = heldShares(t);
  const fmt = (q: number) => q.toLocaleString("de-DE", { maximumFractionDigits: 4 });
  const waiting = (t.tranches ?? []).filter((x) => !x.filledAt);
  const steps: string[] = [];
  if (p.kind === "ausstieg") {
    if (held > 0) steps.push(`Verkauf ${fmt(held)} Stück (bestens)`);
    if (t.stop > 0 && held > 0) steps.push("bisherigen Stop-Loss löschen");
  } else if (p.kind === "teilausstieg") {
    const sell = t.kind === "crypto" ? Math.floor(held * (p.fraction ?? 0.5) * 1e4) / 1e4 : Math.round(held * (p.fraction ?? 0.5));
    if (sell > 0) steps.push(`Verkauf ${fmt(sell)} Stück (bestens)`);
    if (held - sell > 0) steps.push(`Stop-Loss für die restlichen ${fmt(held - sell)} Stück: ${eur(p.stop!)}`);
  } else if (held > 0) steps.push(`Stop-Loss für ${fmt(held)} Stück: ${eur(p.stop!)}`);
  if (waiting.length) steps.push(`wartende Kauf-Order${waiting.length > 1 ? "s" : ""} ${waiting.map((x) => eur(x.price)).join(", ")} löschen`);
  return steps;
}

/** „Bei flatex erledigt“: Vorschlag buchen, Verkauf zum eingegebenen Kurs (in €). */
export function acceptProposal(t: Trade, sellPriceEur?: number): string | null {
  const p = t.proposal;
  if (!p) return null;
  const fx = eurPerUnit(tradeCurrency(t)) ?? 1;
  const price = sellPriceEur && sellPriceEur > 0 ? sellPriceEur / fx : p.price;
  const a: LongTermAction = p.kind === "teilausstieg" ? { kind: "teilausstieg", key: p.key, fraction: p.fraction ?? 0.5, stop: p.stop!, reason: p.reason } : p.kind === "stop" ? { kind: "stop", key: p.key, stop: p.stop!, reason: p.reason } : { kind: "ausstieg", key: p.key, reason: p.reason };
  const msg = applyLongTermAction({ ...t, proposal: undefined }, a, price);
  // Stop ist jetzt bei flatex eingetragen → keine Erinnerung „Stop anpassen“
  actions.updateTrade(t.id, { proposal: undefined, ...(p.stop && p.kind !== "ausstieg" ? { brokerStopEur: p.stop * fx, brokerStopNotified: undefined } : {}) });
  return msg;
}

/** „Ablehnen“: nichts ändern, Meldung merken (kommt nicht wieder) */
export function declineProposal(t: Trade) {
  const p = t.proposal;
  if (!p) return;
  actions.updateTrade(t.id, { proposal: undefined, lastActionKey: p.key, lastActionText: `Vorschlag abgelehnt: ${p.reason}` });
}
