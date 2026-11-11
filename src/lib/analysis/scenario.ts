// Haupt- und Alternativszenario der Elliott-Zählung als Anteile (zusammen 100 %).
// KALIBRIERUNG (191 Werte, Tag+Woche, 84.034 Fälle): Ziel vor Ungültig-Grenze in ~46 % – unabhängig vom Anteil
// (50–55 %: 46,4 %, 60–70 %: 45,2 %, 80–90 %: 40,4 %). Die Prozente sind Regel-Passung, keine Wahrscheinlichkeit.
//
// Blacktrader handelt immer nur das Hauptszenario. Wird die Alternative wahrscheinlicher, wird sie automatisch zum
// Hauptszenario (die Zählung mit der höchsten Wahrscheinlichkeit ist immer das Hauptszenario).
// „notfall“ = Gegenrichtung mit ≥ 85 % der Qualität (≈ Alternative ≥ 42 %). ACHTUNG: Im Zonen-Weg der Analyse (Standard
// in App und Turnier) blockiert das KEINE Einstiege – es ist nur eine Anzeige. Eine Notfall-Regel „45–55 % = neutral,
// kein Einstieg“ wurde getestet (S&P 500 1928–2026: zu wenige Fälle) und vom Nutzer verworfen – nicht wieder vorschlagen.
import type { ElliottResult } from "./elliott";

export type ScenarioState = "gilt" | "notfall";

export interface ScenarioShare {
  /** Anteil Hauptszenario (0–1) */
  main: number;
  /** Anteil Alternative (0–1) */
  alt: number;
  /** Alternative zeigt in die Gegenrichtung */
  opposite: boolean;
  state: ScenarioState;
}

export function scenarioShare(e: Pick<ElliottResult, "best" | "alternative" | "contested"> | null | undefined): ScenarioShare | null {
  const b = e?.best;
  if (!b) return null;
  const a = e.alternative;
  const pb = b.probability;
  const pa = a?.probability ?? 0;
  const sum = pb + pa;
  const main = sum > 0 ? pb / sum : 1;
  return { main, alt: 1 - main, opposite: !!a && a.bias !== b.bias, state: e.contested ? "notfall" : "gilt" };
}
