// Kontrolle der Live-Bilanz (Stufe 1): echte Trefferquote gegen die Erwartung aus der Vergangenheit – gleiche
// Definition wie die Live-Bilanz (nach dem Einstieg zuerst Ziel = Treffer, Stop bzw. Blau-Schlusskurs unter der
// Ungültig-Grenze = kein Treffer), neue Regeln (ein Signal, neue Box). Gemessen 1963–2026, 191 Werte:
//   Grün 50,3 % (2.104 Fälle) · Blau 59,7 % (129) · Rot 19,1 % (152). Je Jahrzehnt schwankt Grün zwischen 43 und 63 %
//   – deshalb wird erst gewarnt, wenn die Abweichung sehr deutlich ist (z ≤ −2,5, also kaum noch Zufall).
// Blacktrader ändert dabei nichts selbst; die Warnung ist für den Nutzer.
import type { ChanceLogEntry } from "./chanceLog";

export const EXPECTED_HIT = { gruen: 0.503, blau: 0.597, rot: 0.191 } as const;
export const LIVE_CHECK = { minAll: 100, minColor: 50, z: 2.5 } as const;

export type LiveVerdict = "zu-wenig" | "erwartet" | "schlechter" | "besser";
export interface LiveGroup {
  n: number;
  hits: number;
  rate: number | null;
  expected: number;
  z: number | null;
  verdict: LiveVerdict;
}

function group(xs: ChanceLogEntry[], expected: number, min: number): LiveGroup {
  const done = xs.filter((x) => x.result === "ziel" || x.result === "stop");
  const n = done.length;
  const hits = done.filter((x) => x.result === "ziel").length;
  if (n < min) return { n, hits, rate: n ? hits / n : null, expected, z: null, verdict: "zu-wenig" };
  const rate = hits / n;
  const z = (rate - expected) / Math.sqrt((expected * (1 - expected)) / n);
  return { n, hits, rate, expected, z, verdict: z <= -LIVE_CHECK.z ? "schlechter" : z >= LIVE_CHECK.z ? "besser" : "erwartet" };
}

export function liveCheck(log: ChanceLogEntry[]): { all: LiveGroup; byColor: Record<"gruen" | "blau" | "rot", LiveGroup>; warn: boolean } {
  const byColor = {
    gruen: group(log.filter((x) => x.color === "gruen"), EXPECTED_HIT.gruen, LIVE_CHECK.minColor),
    blau: group(log.filter((x) => x.color === "blau"), EXPECTED_HIT.blau, LIVE_CHECK.minColor),
    rot: group(log.filter((x) => x.color === "rot"), EXPECTED_HIT.rot, LIVE_CHECK.minColor),
  };
  // Erwartung für alle zusammen: gewichtet nach dem tatsächlichen Mix der abgeschlossenen Chancen
  const nAll = byColor.gruen.n + byColor.blau.n + byColor.rot.n;
  const exp = nAll ? (byColor.gruen.n * EXPECTED_HIT.gruen + byColor.blau.n * EXPECTED_HIT.blau + byColor.rot.n * EXPECTED_HIT.rot) / nAll : EXPECTED_HIT.gruen;
  const all = group(log, exp, LIVE_CHECK.minAll);
  const warn = all.verdict === "schlechter" || Object.values(byColor).some((g) => g.verdict === "schlechter");
  return { all, byColor, warn };
}
