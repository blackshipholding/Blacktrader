// Potenzial eines Einstiegs – gleich gerechnet in den Chancen, im Turnier und im Training.
//
// Grundwert = Chance bis zum Ziel in % (gedeckelt bei 60) × Chance/Risiko (gedeckelt bei 4) / 2 × Gewicht der Signalart.
// Getestet (191 Werte, 1963–2026, alle Starttage à 5 Jahre, 7,90 € je Order, 27,5 % KESt): nur die obere Hälfte
// (Grundwert ≥ 26) zu nehmen bringt +5,6 % statt +4,9 % pro Jahr – mit weniger Trades und Gebühren. Die Grenze wurde
// nur aus 1963–2005 bestimmt und hielt auf den ungesehenen Jahren ab 2006 (+10,2 % statt +8,1 %). Grund: Blacktrader
// hat fast immer alle Plätze belegt (Ø 8,5 von 9, Haltedauer Ø 1 Jahr) – schwache Signale blockieren gute.
//
// NUR FÜR GRÜN/ROT. Blaue Einstiege erreichen den Grundwert nie (Gewicht 0,35, Ungültig-Grenze meist weit weg – im Test
// 0 von 458), sie würden also komplett verschwinden. Für Blau gilt stattdessen die Blau-Regel. Getestet (gleiche Daten):
// Filter Grün/Rot + Blau mit Blau-Regel +5,8 %, + alle Blauen +6,0 %, Filter auf alles (kein Blau) +5,6 %, ohne Filter +4,9 %.
export type PotentialColor = "gruen" | "blau" | "rot";

/** Im Turnier gemessene Stärke je Signalart (relativ zu Grün = 1) */
export const COLOR_WEIGHT: Record<PotentialColor, number> = { gruen: 1, blau: 0.35, rot: 0.6 };

/** Mindest-Grundwert: obere Hälfte der Signale (Median 1963–2005: 25,8) */
export const MIN_POTENTIAL = 26;

export function basePotential(chancePct: number | null | undefined, riskPct: number | null | undefined, color: PotentialColor): number {
  if (chancePct == null || !riskPct || !(chancePct > 0)) return 0;
  const crv = Math.min(4, chancePct / Math.max(0.5, riskPct));
  return Math.min(60, chancePct) * (crv / 2) * COLOR_WEIGHT[color];
}

/**
 * Blau-Regel (Chancen, Turnier und Training gleich): ein blauer Langfrist-Einstieg zählt nur, wenn die Ungültig-Grenze
 * höchstens 40 % unter der Oberkante liegt und die Chance bis zum Ziel mindestens 40 % beträgt (in den Chancen außerdem:
 * Kurs schon im Bereich). Getestet: neutral (+4,9 % mit und ohne, 1963–2026). Eingebaut auf Wunsch, damit Chancen und
 * Turnier gleich handeln. WIEDER ENTFERNBAR: `enabled: false` – das Turnier rechnet zur Kontrolle jedes Mal auch ohne
 * die Regel und meldet, wenn Blacktrader ohne sie besser abschneidet.
 */
export const BLUE_RULE = { enabled: true, maxRiskPct: 40, minChancePct: 40 } as const;

export function passesBlueRule(chancePct: number | null | undefined, riskPct: number | null | undefined): boolean {
  if (!BLUE_RULE.enabled) return true;
  return riskPct != null && riskPct <= BLUE_RULE.maxRiskPct && chancePct != null && chancePct >= BLUE_RULE.minChancePct;
}
