// Hochstufung GRÜN → BLAU: Bestätigt die übergeordnete Wellenzählung (Wochenchart) den Aufwärtstrend, wird ein
// laufender grüner Trade zum langfristigen Einstieg. Stop und Ziel werden nach der Wellenstruktur nachgezogen
// (Stop unter das Tief der letzten abgeschlossenen Korrekturwelle) – der Stop wird NUR nachgezogen, nie zurückgesetzt.
import type { AnalysisResult } from "./analyze";

/** Richtung der großen Welle: unfertiger Impuls → seine Richtung; Korrektur → Gegenrichtung; sonst 0. */
export function bigTrend(res: AnalysisResult | null | undefined): 1 | -1 | 0 {
  const b = res?.elliott.best;
  if (!b || res!.elliott.contested) return 0;
  const impulsive = b.pattern === "impulse" || b.pattern === "leading-diagonal" || b.pattern === "ending-diagonal";
  if (impulsive) return b.complete ? 0 : b.direction;
  return (-b.direction) as 1 | -1;
}

/** Tief der letzten abgeschlossenen Korrekturwelle unter dem Kurs (bestätigter Tiefpunkt der Zählung). */
export function lastCorrectionLow(res: AnalysisResult | null | undefined, price: number): number | null {
  const pv = res?.elliott.best?.pivots ?? [];
  for (let i = pv.length - 1; i >= 0; i--) if (pv[i].type === "L" && pv[i].confirmed && pv[i].price < price) return pv[i].price;
  return null;
}

/** Stop nur nachziehen, nie zurücksetzen. */
export const trailStop = (current: number, candidate: number | null, price: number) => (candidate != null && candidate > current && candidate < price ? candidate : current);

export interface Promotion {
  stop: number;
  targets: number[];
  reason: string;
}

/**
 * Prüft, ob ein offener grüner Long-Trade zu BLAU hochgestuft wird.
 * `weekly` = übergeordnete Zählung, `daily` = Zählung des Trades (für das Korrekturtief).
 */
export function checkPromotion(t: { direction: "long" | "short"; entry: number; stop: number; targets: number[] }, weekly: AnalysisResult | null | undefined, daily: AnalysisResult | null | undefined, price: number): Promotion | null {
  if (t.direction !== "long" || price <= t.entry) return null;
  if (bigTrend(weekly) !== 1) return null;
  const stop = trailStop(t.stop, lastCorrectionLow(daily, price), price);
  const wt = (weekly?.elliott.best?.targets ?? []).filter((x) => x > price).sort((a, b) => a - b);
  const targets = wt.length ? wt.slice(0, 2) : t.targets;
  const b = weekly!.elliott.best!;
  return { stop, targets, reason: `Wochenchart bestätigt den Aufwärtstrend (${b.patternLabel} – ${b.phase}). Stop unter das letzte Korrekturtief nachgezogen.` };
}
