// Ergebnisse in Euro: Rendite eines Trades inklusive Wechselkurs (Kauf- und Verkaufstag).
import { tradeReturnPct } from "../analysis/stats";
import { eurPerUnit } from "../fx";
import type { Trade } from "../store/store";

const EUR_SUFFIX = [".DE", ".F", ".VI", ".PA", ".AS", ".MI", ".MC", ".BR", ".LS", ".HE", ".IR"];

/** Währung eines Trades (ältere Trades ohne Angabe: aus Symbol und Art abgeleitet) */
export function tradeCurrency(t: Pick<Trade, "symbol" | "kind"> & { currency?: string }): string {
  if (t.currency) return t.currency;
  if (t.kind === "crypto") return "USDT";
  const s = t.symbol.toUpperCase();
  if (EUR_SUFFIX.some((x) => s.endsWith(x))) return "EUR";
  if (s.endsWith(".L")) return "GBp";
  if (s.endsWith(".SW")) return "CHF";
  return "USD";
}

/** Rendite in Euro: Kursrendite in der Originalwährung × Wechselkursänderung seit dem Kauf. */
export function toEurReturn(nativePct: number, t: Pick<Trade, "symbol" | "kind"> & { currency?: string; fxEntry?: number }): number {
  const fxNow = eurPerUnit(tradeCurrency(t));
  if (!t.fxEntry || !fxNow) return nativePct; // ohne Kurs beim Kauf (ältere Trades): Kursrendite
  return ((1 + nativePct / 100) * (fxNow / t.fxEntry) - 1) * 100;
}

/** Aktuelle bzw. Schluss-Rendite eines Trades in Euro */
export const tradeReturnEur = (t: Trade, price: number) => toEurReturn(tradeReturnPct(t.direction, t.entry, price), t);

/** Devisenpaar (z. B. EURUSD=X): Kurs ist ein Wechselkurs – nicht in Euro umrechnen */
export const isFxPair = (a: { symbol: string; yahooSymbol?: string }) => /=X$/i.test(a.yahooSymbol ?? a.symbol);
/** Währung für die Anzeige (Devisenpaare ohne Umrechnung) */
export const displayCurrency = (a: { symbol: string; yahooSymbol?: string }, cur?: string) => (isFxPair(a) ? undefined : cur);
