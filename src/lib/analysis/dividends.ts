// Dividenden (rein rechnerisch, ohne Browser): Ex-Tag, Auszahlungstag, Anspruch, Korrekturen von Hand.
//  • Anspruch: wer die Aktie VOR dem Ex-Tag besitzt (Kauf bis zum Tag davor). Verkauf am Ex-Tag oder später behält ihn.
//  • Gutschrift aufs Konto am AUSZAHLUNGSTAG. Yahoo liefert nur den Ex-Tag → Auszahlungstag = Ex-Tag + 21 Tage (Schätzung),
//    der Nutzer kann ihn und den Betrag je Aktie von Hand ändern.
//  • KESt 27,5 % auf jede Dividende (Verlusttopf des Jahres, analysis/kest.ts), keine Gebühr.
const DAY_MS = 86400e3;
export const PAY_LAG_DAYS = 21;
export const DIV_TAX = 0.275;

/** Roh-Dividende aus Yahoo: Ex-Tag in SEKUNDEN, Betrag je Aktie in der Währung des Werts */
export interface RawDividend {
  time: number;
  amount: number;
}

/** Korrektur/Zusatz des Nutzers zu einer Dividende (ex = Ex-Tag in ms, Tagesbeginn UTC) */
export interface DivEdit {
  ex: number;
  /** Betrag je Aktie (Währung des Werts) */
  amount?: number;
  /** Auszahlungstag in ms */
  pay?: number;
  /** zählt nicht (z. B. falsch von Yahoo) */
  skip?: boolean;
  /** vom Nutzer neu angelegt (nicht von Yahoo) */
  manual?: boolean;
}

export interface DivEvent {
  ex: number;
  pay: number;
  amount: number;
  skip: boolean;
  /** vom Nutzer geändert oder angelegt */
  edited: boolean;
  manual: boolean;
}

/** Tagesbeginn (UTC) in ms */
export const dayStart = (ms: number) => Math.floor(ms / DAY_MS) * DAY_MS;

/** Roh-Dividenden + Korrekturen → Ereignisse (nach Ex-Tag sortiert) */
export function mergeEvents(raw: RawDividend[], edits: DivEdit[] = []): DivEvent[] {
  const out = new Map<number, DivEvent>();
  for (const r of raw) {
    if (!(r.amount > 0) || !Number.isFinite(r.time)) continue;
    const ex = dayStart(r.time * 1000);
    out.set(ex, { ex, pay: ex + PAY_LAG_DAYS * DAY_MS, amount: r.amount, skip: false, edited: false, manual: false });
  }
  for (const e of edits) {
    const ex = dayStart(e.ex);
    const base = out.get(ex);
    if (!base && !e.manual) continue; // Korrektur zu einer Dividende, die es nicht mehr gibt
    const amount = e.amount != null && e.amount >= 0 ? e.amount : (base?.amount ?? 0);
    out.set(ex, {
      ex,
      pay: e.pay != null ? dayStart(e.pay) : (base?.pay ?? ex + PAY_LAG_DAYS * DAY_MS),
      amount,
      skip: !!e.skip,
      edited: true,
      manual: !!e.manual && !base,
    });
  }
  return [...out.values()].sort((a, b) => a.ex - b.ex);
}

/** Besitz-Abschnitt: Stückzahl, ab wann (Kauf) und bis wann (Verkauf, offen = undefined) */
export interface Lot {
  qty: number;
  from: number;
  to?: number;
}

/** Stück mit Anspruch auf die Dividende: gekauft VOR dem Ex-Tag, nicht schon VOR dem Ex-Tag verkauft */
export function sharesAtEx(lots: Lot[], ex: number): number {
  let q = 0;
  for (const l of lots) if (l.qty > 0 && l.from < dayStart(ex) && (l.to == null || l.to >= dayStart(ex))) q += l.qty;
  return q;
}

export interface DivCredit {
  ex: number;
  pay: number;
  shares: number;
  /** je Aktie (Währung des Werts) */
  amount: number;
  /** brutto in der Währung des Werts */
  gross: number;
}

/** Dividenden, auf die du Anspruch hast, und die bis `now` ausgezahlt sind (nur mit Stück > 0, ohne „zählt nicht“) */
export function creditsFor(lots: Lot[], events: DivEvent[], now = Date.now()): DivCredit[] {
  const out: DivCredit[] = [];
  for (const e of events) {
    if (e.skip || e.pay > now) continue;
    const shares = sharesAtEx(lots, e.ex);
    if (shares > 0) out.push({ ex: e.ex, pay: e.pay, shares, amount: e.amount, gross: shares * e.amount });
  }
  return out;
}

/** Dividenden, die noch kommen (Ex-Tag liegt vor/nach heute, Zahlung noch offen) – für die Anzeige „erwartet“ */
export function upcomingFor(lots: Lot[], events: DivEvent[], now = Date.now()): DivCredit[] {
  const out: DivCredit[] = [];
  for (const e of events) {
    if (e.skip || e.pay <= now) continue;
    const shares = sharesAtEx(lots, e.ex);
    if (shares > 0) out.push({ ex: e.ex, pay: e.pay, shares, amount: e.amount, gross: shares * e.amount });
  }
  return out;
}

/** Netto nach KESt */
export const netOfTax = (gross: number) => gross * (1 - DIV_TAX);
