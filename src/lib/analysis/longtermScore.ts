// Punkte für einen blauen Langfrist-Einstieg (nur Anzeige – die Handelsregeln für Blau ändern sich dadurch nicht).
// Gleiche Bausteine und Gewichte wie beim Trade-Signal, aber aus Sicht „langfristiger Kauf“:
//   Chartbild   = Langfrist-Struktur: Chance/Risiko bis Ziel 1 (Oberkante bis Ungültig-Grenze), Trendfortsetzung,
//                 Abzug, wenn die Alternative mit Gegenrichtung fast gleich stark ist (Notfall)
//   Firmenzahlen & Nachrichten und Kaufinteresse wie beim Trade-Signal (für langfristige Käufe besonders wichtig).
import type { AnalysisResult } from "./analyze";
import type { LongTermZone } from "./longterm";

export interface LongTermScore {
  total: number;
  chart: number;
  fundamental: number;
  volume: number;
  /** Chance : Risiko bis Ziel 1 */
  crv: number;
  chancePct: number;
  riskPct: number;
}

const clamp = (x: number) => Math.max(0, Math.min(100, x));

export function longTermScore(zone: LongTermZone, a: Pick<AnalysisResult, "weights" | "fundamental" | "volume" | "elliott">): LongTermScore {
  const chancePct = ((zone.targets[0] - zone.zoneTop) / zone.zoneTop) * 100;
  const riskPct = ((zone.zoneTop - zone.invalidation) / zone.zoneTop) * 100;
  const crv = riskPct > 0 ? chancePct / riskPct : 0;
  // CRV 1 → 53, 2 → 71, 3 → 89 Punkte; Trendfortsetzung +8; Notfall −15
  const chart = Math.round(clamp(35 + 18 * Math.min(3, Math.max(0, crv)) + (zone.context === "Trendfortsetzung" ? 8 : 0) - (a.elliott.contested ? 15 : 0)));
  const w = a.weights;
  const sum = w.elliott + w.fundamental + w.volume || 1;
  const total = Math.round((chart * w.elliott + a.fundamental.score * w.fundamental + a.volume.score * w.volume) / sum);
  return { total, chart, fundamental: a.fundamental.score, volume: a.volume.score, crv, chancePct, riskPct };
}
