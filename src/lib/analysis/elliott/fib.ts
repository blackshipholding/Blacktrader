// Fibonacci-Hilfsfunktionen für Wellenverhältnisse, Retracements und Extensionen.

export const FIB_RATIOS = [0.382, 0.5, 0.618, 1.0, 1.618, 2.618] as const;

/**
 * Passung eines Verhältnisses an eine Liste von Zielverhältnissen (0 … 1).
 * 1 = exakter Treffer, linear abnehmend bis 0 bei `tolerance` relativer Abweichung.
 */
let toleranceScale = 1;

/** Führt `fn` mit skalierten Fibonacci-Toleranzbändern aus (lernbar, Standard 1 = unverändert). */
export function withFibToleranceScale<T>(scale: number, fn: () => T): T {
  const prev = toleranceScale;
  toleranceScale = scale;
  try {
    return fn();
  } finally {
    toleranceScale = prev;
  }
}

export function fibFit(ratio: number, targets: readonly number[], tolerance = 0.12): number {
  if (!Number.isFinite(ratio) || ratio <= 0) return 0;
  tolerance *= toleranceScale;
  let best = 0;
  for (const t of targets) {
    const dev = Math.abs(ratio - t) / t;
    best = Math.max(best, 1 - dev / tolerance);
  }
  return Math.max(0, Math.min(1, best));
}

/** Nächstes Fibonacci-Verhältnis zu `ratio`. */
export function nearestFib(ratio: number, targets: readonly number[] = FIB_RATIOS): number {
  return targets.reduce((a, b) => (Math.abs(b - ratio) < Math.abs(a - ratio) ? b : a));
}

/** Retracement-Niveaus einer Bewegung von `from` nach `to`. */
export function retracementLevels(from: number, to: number, ratios: readonly number[] = [0.382, 0.5, 0.618]) {
  return ratios.map((r) => ({ ratio: r, price: to - (to - from) * r }));
}

/** Extension: Länge `length` (signiert über Richtung) × Verhältnis, angesetzt an `base`. */
export function extensionLevels(
  base: number,
  length: number,
  direction: 1 | -1,
  ratios: readonly number[] = [1.0, 1.618, 2.618],
) {
  return ratios.map((r) => ({ ratio: r, price: base + direction * length * r }));
}
