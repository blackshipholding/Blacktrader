"use client";
// Dividenden-Buch: lädt die Dividenden je Aktie (Yahoo über /api/history), merkt sie 24 h auf dem Gerät und rechnet daraus,
// was deine Positionen (Blacktrader-Depot + Buy & Hold) bekommen haben – mit Korrekturen von Hand (AppData.divEdits).
// Regeln: Anspruch = vor dem Ex-Tag besessen; Gutschrift am Auszahlungstag; KESt 27,5 % (analysis/dividends.ts).
import { useSyncExternalStore } from "react";
import { creditsFor, mergeEvents, upcomingFor, type DivCredit, type DivEvent, type Lot, type RawDividend } from "../analysis/dividends";
import { eurPerUnit } from "../fx";
import { getData, type Trade } from "../store/store";
import { tradeCurrency } from "./eur";
import { summarizeHolding, type Holding, type HoldingSummary } from "./holdings";

const KEY = "bt-divs-v1";
const MAX_AGE = 24 * 3600e3;
interface Entry {
  at: number;
  items: RawDividend[];
}
let raw: Record<string, Entry> = {};
let ver = 0;
const subs = new Set<() => void>();
const pending = new Map<string, Promise<void>>();
let loaded = false;

function init() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const j = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (j && typeof j === "object") raw = j;
  } catch {
    /* ohne Speicher */
  }
}
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(raw));
  } catch {
    /* Speicher voll */
  }
}
const bump = () => {
  ver++;
  subs.forEach((f) => f());
};

/** Schlüssel eines Werts („stock:AAPL“) */
export const divKey = (a: { kind: string; symbol: string }) => `${a.kind}:${a.symbol}`;
const ySym = (a: { yahooSymbol?: string; symbol: string }) => a.yahooSymbol ?? a.symbol;

/** Änderungen am Dividenden-Buch melden (für die Weitergabe an Blacktime) */
export function subscribeBook(f: () => void): () => void {
  subs.add(f);
  return () => subs.delete(f);
}

export function useDividendBook(): number {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => {
      init();
      return ver;
    },
    () => 0,
  );
}
export const bookVersion = () => ver;

/** Dividenden eines Werts laden (bei Bedarf), `sinceMs` = frühester Kauf – der Abruf reicht bis dahin zurück */
export async function loadDividends(a: { kind: string; symbol: string; yahooSymbol?: string }, sinceMs: number): Promise<void> {
  init();
  if (a.kind !== "stock") return;
  const k = ySym(a);
  const have = raw[k];
  if (have && Date.now() - have.at < MAX_AGE) return;
  if (pending.has(k)) return pending.get(k);
  const days = Math.min(30 * 365, Math.max(120, Math.ceil((Date.now() - sinceMs) / 86400e3) + 60));
  const p = (async () => {
    try {
      const r = await fetch(`/api/history?yahoo=${encodeURIComponent(k)}&interval=1w&days=${days}`);
      if (!r.ok) return;
      const j = (await r.json()) as { dividends?: RawDividend[] };
      raw[k] = { at: Date.now(), items: Array.isArray(j.dividends) ? j.dividends.filter((d) => d && d.amount > 0 && Number.isFinite(d.time)) : [] };
      save();
      bump();
    } catch {
      /* nächstes Mal */
    } finally {
      pending.delete(k);
    }
  })();
  pending.set(k, p);
  return p;
}

/** Ereignisse eines Werts (Yahoo + deine Korrekturen) */
export function eventsFor(a: { kind: string; symbol: string; yahooSymbol?: string }): DivEvent[] {
  init();
  return mergeEvents(raw[ySym(a)]?.items ?? [], getData().divEdits?.[divKey(a)] ?? []);
}
export const hasData = (a: { yahooSymbol?: string; symbol: string }) => !!raw[ySym(a)];

// ---------------------------------------------------------------------------------------------- Besitz-Abschnitte
const priceEurPerUnit = (cur: string) => eurPerUnit(cur) ?? 1;

/** Stück und Zeiträume eines Blacktrader-Trades (Aktien, long) */
export function lotsOfTrade(t: Trade): Lot[] {
  if (t.kind !== "stock" || t.direction === "short" || t.status === "pending") return [];
  const end = t.status === "closed" ? t.closedAt : undefined;
  type Piece = { qty: number; from: number };
  let pieces: Piece[] = [];
  if (t.strategy === "longterm" && t.tranches?.length) {
    pieces = t.tranches.filter((x) => x.filledAt && (x.qty ?? 0) > 0).map((x) => ({ qty: x.qty!, from: x.filledAt! }));
  } else {
    const fx = t.fxEntry ?? priceEurPerUnit(tradeCurrency(t));
    const qty = t.shares ?? (t.stakeEur && t.entry > 0 ? t.stakeEur / (t.entry * fx) : 0);
    if (qty > 0) pieces = [{ qty, from: t.openedAt }];
  }
  const parts = [...(t.partials ?? [])].sort((a, b) => a.at - b.at);
  const out: Lot[] = [];
  for (const p of pieces) {
    let remaining = p.qty;
    for (const pa of parts) {
      if (pa.at <= p.from) continue;
      const sold = remaining * Math.min(1, Math.max(0, pa.fraction));
      if (sold > 0) out.push({ qty: sold, from: p.from, to: pa.at });
      remaining -= sold;
    }
    if (remaining > 1e-9) out.push({ qty: remaining, from: p.from, to: end });
  }
  return out;
}

/** Stück und Zeiträume einer Buy-&-Hold-Position (aus Käufen und Verkäufen, FIFO) */
export function lotsOfHolding(h: Holding): Lot[] {
  if (h.kind !== "stock") return [];
  const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);
  const txs = [...h.txs].filter((t) => t.type !== "div").sort((a, b) => a.date.localeCompare(b.date) || (a.type === "buy" ? -1 : 1));
  const open: { qty: number; from: number }[] = [];
  const out: Lot[] = [];
  for (const t of txs) {
    if (t.type === "buy") open.push({ qty: t.qty, from: ms(t.date) });
    else {
      let rest = t.qty;
      while (rest > 1e-9 && open.length) {
        const l = open[0];
        const q = Math.min(l.qty, rest);
        out.push({ qty: q, from: l.from, to: ms(t.date) });
        l.qty -= q;
        rest -= q;
        if (l.qty < 1e-9) open.shift();
      }
    }
  }
  for (const l of open) out.push({ qty: l.qty, from: l.from });
  return out;
}

export interface TradeCredit extends DivCredit {
  tradeId: string;
  symbol: string;
  name: string;
  /** brutto in Euro */
  grossEur: number;
}

/** Ausgezahlte Dividenden deiner Blacktrader-Trades (bis jetzt), in Euro */
export function creditsOfTrades(trades: Trade[], now = Date.now()): TradeCredit[] {
  const out: TradeCredit[] = [];
  for (const t of trades) {
    const lots = lotsOfTrade(t);
    if (!lots.length) continue;
    const ev = eventsFor(t);
    if (!ev.length) continue;
    const fx = priceEurPerUnit(tradeCurrency(t));
    for (const c of creditsFor(lots, ev, now)) out.push({ ...c, tradeId: t.id, symbol: t.symbol, name: t.name, grossEur: c.gross * fx });
  }
  return out.sort((a, b) => a.pay - b.pay);
}

/** Dividenden einer Buy-&-Hold-Position (ausgezahlt bis jetzt), in Euro; von Hand eingetragene Dividenden gehen vor */
export function creditsOfHolding(h: Holding, now = Date.now()): { date: string; grossEur: number; ex: number; pay: number; shares: number; amount: number }[] {
  const lots = lotsOfHolding(h);
  if (!lots.length) return [];
  const fx = priceEurPerUnit(h.currency ?? "USD");
  const manual = h.txs.filter((t) => t.type === "div").map((t) => Date.parse(`${t.date}T00:00:00Z`));
  const out: { date: string; grossEur: number; ex: number; pay: number; shares: number; amount: number }[] = [];
  for (const c of creditsFor(lots, eventsFor(h), now)) {
    // Handeintrag zwischen Ex-Tag und 30 Tage nach Auszahlung = ersetzt die automatische Dividende
    if (manual.some((m) => m >= c.ex && m <= c.pay + 30 * 86400e3)) continue;
    out.push({ date: new Date(c.pay).toISOString().slice(0, 10), grossEur: c.gross * fx, ex: c.ex, pay: c.pay, shares: c.shares, amount: c.amount });
  }
  return out;
}

/** Noch nicht ausgezahlte Dividenden einer Position (Anzeige „erwartet“) */
export function upcomingOf(lots: Lot[], a: { kind: string; symbol: string; yahooSymbol?: string }, now = Date.now()): DivCredit[] {
  return upcomingFor(lots, eventsFor(a), now);
}

/** Alle Werte, deren Dividenden für Konto und Depot gebraucht werden, laden */
export function loadForPositions(trades: Trade[], holdings: Holding[]): void {
  const need = new Map<string, { a: { kind: string; symbol: string; yahooSymbol?: string }; since: number }>();
  const add = (a: { kind: string; symbol: string; yahooSymbol?: string }, since: number) => {
    if (a.kind !== "stock") return;
    const k = ySym(a);
    const cur = need.get(k);
    if (!cur || since < cur.since) need.set(k, { a, since });
  };
  for (const t of trades) if (t.direction !== "short" && (t.status !== "pending" || (t.tranches ?? []).some((x) => x.filledAt))) add(t, t.openedAt);
  for (const h of holdings) {
    const first = h.txs.map((x) => Date.parse(`${x.date}T00:00:00Z`)).sort((a, b) => a - b)[0];
    if (first) add(h, first);
  }
  for (const { a, since } of need.values()) void loadDividends(a, since);
}

/** Zusammenfassung einer Buy-&-Hold-Position inkl. automatischer Dividenden */
export function holdingSummary(h: Holding): HoldingSummary {
  return summarizeHolding(h, creditsOfHolding(h).map((c) => ({ date: c.date, gross: c.grossEur })));
}

/** Nur für Tests: Roh-Dividenden eines Werts setzen */
export function __setRawDividends(yahooSymbol: string, items: RawDividend[]) {
  init();
  raw[yahooSymbol] = { at: Date.now(), items };
  bump();
}
