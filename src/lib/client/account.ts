// Blacktrader-Konto im Depot: echtes Geld-Modell statt „jeder Trade mit dem ganzen Geld“.
// 8.000 € Start, 500 € je Trade (echter Betrag aus Stück × Kurs, bis 50 € darüber), 7,90 € Gebühr je Order (flatex), 27,5 % KESt sofort bei Gewinn mit Verlustausgleich
// im selben Kalenderjahr. Langfrist-Trades (blau): 500 € gesamt, jede ausgeführte Teil-Order kostet eine Gebühr.
// Reicht das Geld nicht für einen neuen Trade (500 € + Gebühr), wird nichts übernommen. Ohne Geld UND ohne offene
// Position ist das Konto leer (pleite) – Neustart mit 8.000 €; alte Trades bleiben als frühere Runde sichtbar.
import type { Trade } from "../store/store";
import { KestYear } from "../analysis/kest";

export const ACCOUNT = { start: 8000, stake: 500, fee: 7.9, tax: 0.275 } as const;
/** Nachkauf nur bei Blau: höchstens 4 × 250 € je Wert (zusätzlich zum ersten Einstieg mit 500 €) */
export const ADD = { max: 4, stake: 250 } as const;

const yearOf = (ms: number) => new Date(ms).getUTCFullYear();
/** Eingesetzter Betrag eines Trades (Stück × Kurs beim Übernehmen; ältere Trades: 500 €) */
export const stakeOf = (t: Pick<Trade, "stakeEur">) => (t.stakeEur && t.stakeEur > 0 ? t.stakeEur : ACCOUNT.stake);

/** Gehört der Trade zum Konto? (übernommen; verfallene Orders ohne Ausführung zählen nicht) */
export function countsForAccount(t: Trade): boolean {
  if (t.strategy === "core") return false;
  if (t.status === "closed" && t.closeReason === "cancelled" && t.returnPct == null) return false;
  return true;
}

/** Anzahl Kauf-Orders (Langfrist: ausgeführte Teile, mindestens 1) */
const buyOrders = (t: Trade) => (t.strategy === "longterm" ? Math.max(1, (t.tranches ?? []).filter((x) => x.filledAt).length) : 1);
/** Anzahl Verkaufs-Orders (Teilausstiege + Schlussverkauf) */
const sellOrders = (t: Trade) => (t.partials ?? []).filter((x) => !x.noFee).length + (t.sellFeeShared ? 0 : 1);
/**
 * Tatsächlich gekaufter Betrag (Gewinn/Verlust nur darauf). Blau in drei Teilen: nur die ausgeführten Teile –
 * der Rest der 500 € ist für die wartenden Limit-Orders reserviert und bringt weder Gewinn noch Verlust.
 */
export function investedOf(t: Trade): number {
  const st = stakeOf(t);
  if (t.strategy !== "longterm" || !t.tranches?.length) return st;
  const n = t.tranches.length;
  return t.tranches.reduce((a, x) => a + (x.filledAt ? x.eur ?? st / n : 0), 0);
}

export interface RoundSummary {
  round: number;
  from: number;
  to?: number;
  start: number;
  /** Kontostand (frei + offene Positionen zum aktuellen Kurs) */
  equity: number;
  cash: number;
  /** In offenen Positionen bzw. wartenden Orders gebunden (Einsatz) */
  invested: number;
  profit: number;
  profitPct: number;
  fees: number;
  tax: number;
  closed: number;
  wins: number;
  open: number;
  /** Kein Geld für einen neuen Trade (500 € + Gebühr) */
  blocked: boolean;
  /** Kein Geld und keine offene Position mehr */
  broke: boolean;
  /** Verlauf nach jedem geschlossenen Trade: Gewinn in % vom Start */
  curve: { time: number; equity: number; cumulative: number }[];
}

/**
 * Rechnet eine Runde des Kontos durch. `openReturnEur(t)` liefert die aktuelle Rendite offener Trades in Euro (oder null).
 */
export function computeRound(trades: Trade[], from: number, to: number | undefined, round: number, openReturnEur: (t: Trade) => number | null): RoundSummary {
  const inRound = trades.filter((t) => countsForAccount(t) && t.openedAt >= from && (to == null || t.openedAt < to));
  type Ev = { at: number; kind: 0 | 1; t: Trade };
  const ev: Ev[] = [];
  for (const t of inRound) {
    ev.push({ at: t.openedAt, kind: 1, t });
    if (t.status === "closed" && t.closedAt != null) ev.push({ at: t.closedAt, kind: 0, t });
  }
  ev.sort((a, b) => a.at - b.at || a.kind - b.kind);
  let cash: number = ACCOUNT.start;
  let fees = 0;
  let tax = 0;
  const kest = new KestYear(ACCOUNT.tax);
  let closed = 0;
  let wins = 0;
  const open = new Set<Trade>();
  const curve: RoundSummary["curve"] = [];
  for (const e of ev) {
    const t = e.t;
    if (e.kind === 1) {
      // Wartende Orders reservieren das Geld schon (wie bei der Bank); Gebühr erst bei Ausführung
      const executed = t.status !== "pending";
      const f = executed ? buyOrders(t) * ACCOUNT.fee : 0;
      cash -= stakeOf(t) + f;
      fees += f;
      open.add(t);
      continue;
    }
    if (!open.has(t)) continue;
    open.delete(t);
    const r = t.returnPct ?? 0;
    const st = stakeOf(t);
    const g = (investedOf(t) * r) / 100;
    const f = sellOrders(t) * ACCOUNT.fee;
    cash += st + g - f;
    fees += f;
    // KESt mit Verlusttopf im Kalenderjahr (analysis/kest.ts)
    const k = kest.settle(g, yearOf(e.at));
    cash -= k;
    tax += k;
    closed++;
    if (g - (buyOrders(t) + sellOrders(t)) * ACCOUNT.fee > 0) wins++;
    curve.push({ time: e.at, equity: cash, cumulative: ((cash + [...open].reduce((a, x) => a + stakeOf(x), 0) - ACCOUNT.start) / ACCOUNT.start) * 100 });
  }
  let openValue = 0;
  for (const t of open) {
    const r = t.status === "open" ? openReturnEur(t) : null;
    openValue += stakeOf(t) + (investedOf(t) * (r ?? 0)) / 100;
  }
  const equity = cash + openValue;
  const invested = [...open].reduce((a, x) => a + stakeOf(x), 0);
  const blocked = cash < ACCOUNT.stake + ACCOUNT.fee;
  return {
    round,
    from,
    to,
    start: ACCOUNT.start,
    equity,
    cash,
    invested,
    profit: equity - ACCOUNT.start,
    profitPct: ((equity - ACCOUNT.start) / ACCOUNT.start) * 100,
    fees,
    tax,
    closed,
    wins,
    open: open.size,
    blocked,
    broke: blocked && open.size === 0,
    curve,
  };
}

/** Alle Runden (nach jedem Neustart eine neue); die letzte ist die aktuelle. */
export function computeAccount(trades: Trade[], resets: number[], openReturnEur: (t: Trade) => number | null): RoundSummary[] {
  const bounds = [0, ...[...resets].sort((a, b) => a - b)];
  return bounds.map((from, i) => computeRound(trades, from, bounds[i + 1], i + 1, openReturnEur));
}

/** Freies Geld der aktuellen Runde (für die Prüfung vor dem Übernehmen) */
export function freeCash(trades: Trade[], resets: number[]): number {
  const rounds = computeAccount(trades, resets, () => null);
  return rounds[rounds.length - 1].cash;
}

/** Reicht das Geld für einen neuen Trade (Betrag, Standard 500 €, + 7,90 € Gebühr)? */
export const canAfford = (trades: Trade[], resets: number[], amount: number = ACCOUNT.stake) => freeCash(trades, resets) >= amount + ACCOUNT.fee;

/** Hinweis, wenn das Geld für einen neuen Trade nicht reicht (direkt in der App sichtbar) */
export function noMoney(free?: number) {
  const f = free == null ? "" : ` Frei sind ${free.toFixed(2).replace(".", ",")} €.`;
  const text = `Nicht genug Geld: Für einen neuen Trade brauchst du ${ACCOUNT.stake} € + ${ACCOUNT.fee.toFixed(2).replace(".", ",")} € Gebühr.${f} Erst muss ein offener Trade schließen – oder im Depot neu starten, wenn das Konto leer ist.`;
  if (typeof window !== "undefined" && typeof window.alert === "function") window.alert(text);
}

export interface SimTrade {
  sym: string;
  /** Einstieg und Ausstieg (Millisekunden) */
  entry: number;
  exit: number;
  /** Rendite in % */
  r: number;
  /** Blauer (langfristiger) Einstieg – nur dort ist Nachkauf erlaubt */
  blue?: boolean;
}

export interface SimResult {
  start: number;
  end: number;
  profit: number;
  profitPct: number;
  fees: number;
  tax: number;
  taken: number;
  /** ausgelassen, weil das Geld nicht reichte oder der Wert schon im Depot lag */
  skipped: number;
  broke: boolean;
}

/**
 * Spielt Trades mit dem Konto durch (für das EchoChart): 8.000 € Start, 500 € je Trade nur wenn genug Geld da ist
 * (je Wert höchstens eine Position), 7,90 € je Order, 27,5 % KESt sofort auf Gewinne mit Verlustausgleich im Jahr.
 */
export function simulateAccount(trades: SimTrade[]): SimResult {
  type Ev = { at: number; kind: 0 | 1; i: number };
  const ev: Ev[] = [];
  trades.forEach((t, i) => {
    ev.push({ at: t.entry, kind: 1, i });
    ev.push({ at: t.exit, kind: 0, i });
  });
  ev.sort((a, b) => a.at - b.at || a.kind - b.kind);
  let cash: number = ACCOUNT.start;
  let fees = 0;
  let tax = 0;
  const kest = new KestYear(ACCOUNT.tax);
  let taken = 0;
  let skipped = 0;
  let broke = false;
  const open = new Map<number, number>(); // Trade → Einsatz
  const per = new Map<string, number>();
  for (const e of ev) {
    const t = trades[e.i];
    if (e.kind === 1) {
      // Je Wert eine Position; Nachkauf nur bei Blau, höchstens ADD.max × ADD.stake
      const have = per.get(t.sym) ?? 0;
      const stake = have > 0 ? ADD.stake : ACCOUNT.stake;
      if (broke || (have > 0 && (!t.blue || have > ADD.max)) || cash < stake + ACCOUNT.fee) {
        if (!broke && cash < stake + ACCOUNT.fee && open.size === 0) broke = true;
        skipped++;
        continue;
      }
      cash -= stake + ACCOUNT.fee;
      fees += ACCOUNT.fee;
      open.set(e.i, stake);
      per.set(t.sym, have + 1);
      taken++;
      continue;
    }
    if (!open.has(e.i)) continue;
    const st = open.get(e.i)!;
    open.delete(e.i);
    per.set(t.sym, (per.get(t.sym) ?? 1) - 1);
    const g = (st * t.r) / 100;
    cash += st + g - ACCOUNT.fee;
    fees += ACCOUNT.fee;
    const k = kest.settle(g, yearOf(e.at));
    cash -= k;
    tax += k;
  }
  return { start: ACCOUNT.start, end: cash, profit: cash - ACCOUNT.start, profitPct: ((cash - ACCOUNT.start) / ACCOUNT.start) * 100, fees, tax, taken, skipped, broke };
}

/** Hinweis: Wert liegt schon im Depot – nachkaufen nur bei blauen Einstiegen */
export function noTwice() {
  if (typeof window !== "undefined" && typeof window.alert === "function") window.alert("Diesen Wert hast du schon im Depot. Nachkaufen geht nur bei einem weiteren blauen (langfristigen) Einstieg – höchstens 4 × 250 €.");
}
