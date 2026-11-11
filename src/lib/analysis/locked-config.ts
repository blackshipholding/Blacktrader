// FESTE WERTE – dürfen vom Trainer NIEMALS verändert werden.
// Methode, Gewichtung und Risiko-Logik. Das Objekt ist tief eingefroren (schreibgeschützt);
// tests/locked.test.ts schlägt fehl, sobald sich hier etwas ändert oder der Trainer daran rührt.

function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object") {
    Object.values(o as Record<string, unknown>).forEach(deepFreeze);
    Object.freeze(o);
  }
  return o;
}

export const LOCKED = deepFreeze({
  /** Standard-Gewichtung: 60 % Elliott + 20 % Fundamental/News + 20 % Volumen/RSI */
  weights: { elliott: 60, fundamental: 20, volume: 20 },
  /** Feste Grenzen für jede Gewichtung (Trainer UND Einstellungen): Elliott bleibt immer primär */
  weightBounds: { elliottMin: 60, fundamentalMin: 10, volumeMin: 10, sum: 100 },
  /** Mindest-Signalstärke darf je Version nur steigen, nie sinken */
  minStrengthOnlyUp: true,
  /** Regeln gegen Selbstbetrug: Mindestanzahl Signale, max. Rückgang Signale/Monat, PF und Drawdown nicht schlechter */
  acceptance: { minSignals: 200, maxSignalDrop: 0.4, profitFactorNotLower: true, drawdownNotWorse: true },
  /** Mindest-Chance-Risiko-Verhältnis */
  minRiskReward: 1.5,
  /** Elliott-Regeln (werden in patterns.ts als harte Regeln geprüft) */
  elliottRules: [
    "Welle 2 fällt nie unter den Start von Welle 1",
    "Welle 3 ist nie die kürzeste Impulswelle",
    "Welle 4 überlappt nicht mit Welle 1 (außer Diagonale)",
  ],
  elliottPatterns: ["impulse", "leading-diagonal", "ending-diagonal", "zigzag", "double-zigzag", "triple-zigzag", "flat-regular", "flat-expanded", "flat-running", "triangle-contracting", "triangle-expanding", "combination-wxy", "combination-wxyxz"],
  /** Zielzonen-Einstieg: Einstieg, Zone, Stop, Ziel (Risiko-Logik) */
  zone: { entryRetrace: 0.618, zoneDeep: 0.786, bottomAboveStop: 0.01, stopBufferAtr: 0.25, minWaveAtr: 4, target1Ext: 0.272, trendFilter: true },
  /** Trade-Verwaltung: Gewinne laufen lassen */
  trade: { exitMode: "trail", trailAtr: 4, maxWaitBars: 60, maxHoldBars: 200 },
  /**
   * Langfristiger Einstieg (blau): Bereich 61,8–88,6 % Korrektur einer großen Aufwärtswelle, Einstieg in 3 Teilen,
   * Invalidierung = Schlusskurs unter dem Wellenstart. Kein fester Stop – Teilausstieg/Stop nur bei geänderter Zählung.
   */
  longterm: { atrMult: 6, minMoveAtr: 8, zoneTop: 0.618, zoneBottom: 0.886, tranches: 3 },
  /** Anzeige "Hohes Risiko" ab diesem Stop-Abstand in % (Positionsgröße bleibt Sache des Nutzers) */
  riskBadgePct: 15,
  horizons: { short: ["5m", "15m", "1h"], medium: ["4h", "1d"], long: ["1w", "1M"] },
  signalKinds: { trade: "grün", short: "rot", longterm: "blau" },
} as const);

export type Locked = typeof LOCKED;
