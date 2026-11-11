// Zonen-Erfolg wie bei HKCM: Der Kurs taucht in die Zone ein, dreht VOR der Unterkante und läuft oben aus der
// Zone heraus (Short gespiegelt). Gescheitert: Kurs über die Unterkante hinaus, bevor er herausläuft.
// Erreicht der Kurs die Zone nicht (oder läuft vorher davon), zählt die Zone nicht.
import type { Candle } from "../types";

export type ZoneResult = "erfolg" | "gescheitert";

export interface ZoneCheck {
  /** Oberkante (Einstiegsseite) und Unterkante (Invalidierungsseite) – bei Short umgekehrt */
  top: number;
  bottom: number;
  dir: 1 | -1;
  /** Ohne Eintauchen verfallen, wenn der Kurs darüber (Long) bzw. darunter (Short) läuft */
  cancel?: number;
  /** Höchstens so viele Kerzen auf das Eintauchen warten */
  maxWait: number;
}

/** Ergebnis ab Kerze `from` (nur Kerzen danach). `at` = Zeitpunkt, an dem das Ergebnis feststand. */
export function zoneOutcome(c: Candle[], from: number, z: ZoneCheck): { result: ZoneResult; at: number } | null {
  let entered = false;
  for (let j = from + 1; j < c.length; j++) {
    const k = c[j];
    if (!entered) {
      if (j > from + z.maxWait) return null;
      if (z.cancel != null && (z.dir === 1 ? k.high > z.cancel : k.low < z.cancel) && !(z.dir === 1 ? k.low <= z.top : k.high >= z.top)) return null;
      if (z.dir === 1 ? k.low <= z.top : k.high >= z.top) entered = true;
      else continue;
    }
    if (z.dir === 1 ? k.low < z.bottom : k.high > z.bottom) return { result: "gescheitert", at: k.time };
    if (z.dir === 1 ? k.close > z.top : k.close < z.top) return { result: "erfolg", at: k.time };
  }
  return null;
}
