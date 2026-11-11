// Finanz-Prüfung (Wunsch des Nutzers): Firmen, die viel zu schlecht dastehen und pleitegehen können, nicht aufnehmen.
// Schwach = hohe Schulden (mehr als das Doppelte des Eigenkapitals) UND zusätzlich mindestens eines:
//   verbrennt Geld (freier Geldzufluss negativ) · große Verluste (Gewinnmarge schlechter als −20 %) ·
//   Umsatz bricht ein (mehr als −30 %).
// Firmen mit wenig Schulden (z. B. Geld aus Kapitalerhöhungen wie Rigetti, D-Wave) und profitable Firmen mit hohen
// Schulden (Zoetis, Celanese) kommen durch. Nicht rückwirkend testbar (keine alten Firmenzahlen) – nur live.
import type { Fundamentals } from "../types";

export const FINANCE_RULE = { maxDebtToEquity: 2, minMargin: -0.2, minRevenueGrowth: -0.3 } as const;

export function financeCheck(f: Fundamentals | null | undefined): { weak: boolean; reason?: string } {
  if (!f || f.kind !== "stock" || f.debtToEquity == null) return { weak: false };
  const de = f.debtToEquity / 100; // Yahoo liefert Prozent
  if (de <= FINANCE_RULE.maxDebtToEquity) return { weak: false };
  const burn = f.freeCashflow != null && f.freeCashflow < 0;
  const losses = f.profitMargin != null && f.profitMargin < FINANCE_RULE.minMargin;
  const collapse = f.revenueGrowth != null && f.revenueGrowth < FINANCE_RULE.minRevenueGrowth;
  if (!burn && !losses && !collapse) return { weak: false };
  const why = [burn && "verbrennt Geld", losses && "hohe Verluste", collapse && "Umsatz bricht ein"].filter(Boolean).join(", ");
  return { weak: true, reason: `Finanzen schwach: Schulden ${de.toLocaleString("de-DE", { maximumFractionDigits: 1 })}-fach des Eigenkapitals, ${why}.` };
}
