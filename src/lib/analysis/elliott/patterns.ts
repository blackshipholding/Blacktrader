// Mustererkennung für Elliott-Wellen auf Basis einer Pivot-Folge.
// Jede Funktion erhält genau die Pivots des Musters (Start + Wellenenden) und liefert
// eine Bewertung oder null, wenn eine harte Regel verletzt ist.
import type { Pivot } from "../zigzag";
import { fibFit } from "./fib";

export type PatternType =
  | "impulse"
  | "leading-diagonal"
  | "ending-diagonal"
  | "zigzag"
  | "double-zigzag"
  | "triple-zigzag"
  | "flat-regular"
  | "flat-expanded"
  | "flat-running"
  | "triangle-contracting"
  | "triangle-expanding"
  | "combination-wxy"
  | "combination-wxyxz";

export const PATTERN_LABEL: Record<PatternType, string> = {
  impulse: "Impuls 1-2-3-4-5",
  "leading-diagonal": "Leading Diagonal",
  "ending-diagonal": "Ending Diagonal",
  zigzag: "Zigzag A-B-C",
  "double-zigzag": "Double Zigzag W-X-Y",
  "triple-zigzag": "Triple Zigzag W-X-Y-X-Z",
  "flat-regular": "Flat (regulär)",
  "flat-expanded": "Flat (expanded)",
  "flat-running": "Flat (running)",
  "triangle-contracting": "Dreieck (kontrahierend)",
  "triangle-expanding": "Dreieck (expandierend)",
  "combination-wxy": "Kombination W-X-Y",
  "combination-wxyxz": "Kombination W-X-Y-X-Z",
};

export interface RuleResult {
  name: string;
  passed: boolean;
  /** Harte Regel: Verletzung verwirft die Zählung */
  hard: boolean;
}

export interface PatternEval {
  pattern: PatternType;
  /** Richtung der ersten Welle (1 = aufwärts) */
  direction: 1 | -1;
  /** Labels für pivots[1..] (pivots[0] ist der Startpunkt) */
  labels: string[];
  rules: RuleResult[];
  /** Fibonacci-/Richtlinien-Passung 0 … 1 */
  fib: number;
  notes: string[];
  extension?: 1 | 3 | 5;
}

const lens = (p: Pivot[]) => p.slice(1).map((x, i) => Math.abs(x.price - p[i].price));
const dirOf = (p: Pivot[]): 1 | -1 => (p[1].price > p[0].price ? 1 : -1);
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const hardOk = (rules: RuleResult[]) => rules.every((r) => !r.hard || r.passed);

// ---------------------------------------------------------------- Impulse / Diagonalen

/**
 * Prüft Impulse (vollständig oder teilweise). `pv.length` = Anzahl Wellen + 1 (3 … 6).
 * Harte Regeln: W2 nie unter Start W1, W3 nie die kürzeste, W4 nicht im Bereich von W1.
 */
export function evalImpulse(pv: Pivot[]): PatternEval | null {
  const n = pv.length - 1;
  if (n < 2 || n > 5) return null;
  const d = dirOf(pv);
  const q = pv.map((x) => x.price * d); // normalisiert auf Aufwärtsrichtung
  const L = lens(pv);
  const rules: RuleResult[] = [];
  rules.push({ name: "Welle 2 fällt nie unter den Start von Welle 1", passed: q[2] > q[0], hard: true });
  if (n >= 3) rules.push({ name: "Welle 3 übersteigt das Ende von Welle 1", passed: q[3] > q[1], hard: true });
  if (n >= 4) rules.push({ name: "Welle 4 überlappt nicht mit Welle 1", passed: q[4] > q[1], hard: true });
  if (n >= 5) {
    rules.push({ name: "Welle 3 ist nicht die kürzeste Impulswelle", passed: !(L[2] < L[0] && L[2] < L[4]), hard: true });
    rules.push({ name: "Welle 5 übersteigt das Ende von Welle 3 (sonst Truncation)", passed: q[5] > q[3], hard: false });
  } else if (n >= 3) {
    // Welle 3 kürzer als 1 ist erlaubt, begrenzt aber Welle 5.
    rules.push({ name: "Welle 3 länger als Welle 1 (typisch)", passed: L[2] >= L[0], hard: false });
  }
  if (!hardOk(rules)) return null;

  const fits: number[] = [];
  const notes: string[] = [];
  const r2 = L[1] / L[0];
  fits.push(fibFit(r2, [0.5, 0.618, 0.786]));
  if (n >= 3) fits.push(fibFit(L[2] / L[0], [1.618, 2.618, 1.0]));
  if (n >= 4) {
    const r4 = L[3] / L[2];
    fits.push(fibFit(r4, [0.236, 0.382, 0.5]));
    // Alternation: tiefe Welle 2 ↔ flache Welle 4 (oder umgekehrt)
    const alternation = Math.min(1, Math.abs(r2 - r4) / 0.25);
    fits.push(alternation);
    if (alternation > 0.6) notes.push("Gute Alternation zwischen Welle 2 und 4.");
  }
  let extension: 1 | 3 | 5 | undefined;
  if (n >= 5) {
    fits.push(Math.max(fibFit(L[4] / L[0], [0.618, 1.0, 1.618]), fibFit(L[4] / (q[3] - q[0]), [0.618])));
    const [a, b, c] = [L[0], L[2], L[4]];
    if (b > 1.5 * a && b > 1.5 * c) extension = 3;
    else if (c > 1.5 * a && c > 1.5 * b) extension = 5;
    else if (a > 1.5 * b && a > 1.5 * c) extension = 1;
    if (extension) notes.push(`Extension in Welle ${extension}.`);
    if (q[5] <= q[3]) notes.push("Gekappte (truncated) fünfte Welle.");
  }
  return {
    pattern: "impulse",
    direction: d,
    labels: ["1", "2", "3", "4", "5"].slice(0, n),
    rules,
    fib: avg(fits) * (rules.every((r) => r.passed) ? 1 : 0.8),
    notes,
    extension,
  };
}

/** Diagonale (5 Wellen, Überlappung W4/W1, keilförmig). Leading/Ending wird vom Kontext entschieden. */
export function evalDiagonal(pv: Pivot[], kind: "leading-diagonal" | "ending-diagonal"): PatternEval | null {
  if (pv.length !== 6) return null;
  const d = dirOf(pv);
  const q = pv.map((x) => x.price * d);
  const L = lens(pv);
  const contracting = L[2] < L[0] && L[4] < L[2] && L[3] < L[1];
  const expanding = L[2] > L[0] && L[4] > L[2] && L[3] > L[1];
  const rules: RuleResult[] = [
    { name: "Welle 2 fällt nie unter den Start von Welle 1", passed: q[2] > q[0], hard: true },
    { name: "Welle 3 übersteigt das Ende von Welle 1", passed: q[3] > q[1], hard: true },
    { name: "Welle 4 überlappt Welle 1 (Diagonal-Merkmal)", passed: q[4] <= q[1], hard: true },
    { name: "Welle 4 fällt nicht unter das Ende von Welle 2", passed: q[4] > q[2], hard: true },
    { name: "Welle 3 ist nicht die kürzeste", passed: !(L[2] < L[0] && L[2] < L[4]), hard: true },
    { name: "Keilform (kontrahierend oder expandierend)", passed: contracting || expanding, hard: true },
    { name: "Welle 5 übersteigt Welle 3", passed: q[5] > q[3], hard: false },
  ];
  if (!hardOk(rules)) return null;
  const fits = [
    fibFit(L[1] / L[0], [0.618, 0.786, 0.5]),
    fibFit(L[3] / L[2], [0.618, 0.786, 0.5]),
    fibFit(L[2] / L[0], contracting ? [0.618, 0.786] : [1.272, 1.618]),
  ];
  return {
    pattern: kind,
    direction: d,
    labels: ["1", "2", "3", "4", "5"],
    rules,
    fib: avg(fits),
    notes: [contracting ? "Kontrahierender Keil." : "Expandierender Keil."],
  };
}

// ---------------------------------------------------------------- Korrekturen (3 Wellen)

/** Zigzag 5-3-5: B retraciert < 100 % von A, C läuft über das Ende von A hinaus. */
export function evalZigzag(pv: Pivot[]): PatternEval | null {
  if (pv.length !== 4 && pv.length !== 3) return null;
  const d = dirOf(pv);
  const q = pv.map((x) => x.price * d);
  const L = lens(pv);
  const rB = L[1] / L[0];
  const rules: RuleResult[] = [
    { name: "B retraciert weniger als 100 % von A", passed: q[2] > q[0], hard: true },
    { name: "B retraciert höchstens ~80 % von A (Zigzag-typisch)", passed: rB <= 0.8, hard: pv.length === 4 },
  ];
  const fits = [fibFit(rB, [0.382, 0.5, 0.618])];
  if (pv.length === 4) {
    rules.push({ name: "C läuft über das Ende von A hinaus", passed: q[3] > q[1], hard: true });
    fits.push(fibFit(L[2] / L[0], [1.0, 0.618, 1.618]));
  }
  if (!hardOk(rules)) return null;
  return {
    pattern: "zigzag",
    direction: d,
    labels: ["A", "B", "C"].slice(0, pv.length - 1),
    rules,
    fib: avg(fits),
    notes: [],
  };
}

/** Flat 3-3-5: B retraciert ≥ 90 % von A. Varianten regulär, expanded, running. */
export function evalFlat(pv: Pivot[]): PatternEval | null {
  if (pv.length !== 4) return null;
  const d = dirOf(pv);
  const q = pv.map((x) => x.price * d);
  const L = lens(pv);
  const rB = L[1] / L[0];
  const rC = L[2] / L[0];
  if (rB < 0.9) return null;
  let pattern: PatternType;
  const fits: number[] = [];
  if (rB <= 1.05 && rC >= 0.85 && rC <= 1.25) {
    pattern = "flat-regular";
    fits.push(fibFit(rB, [1.0], 0.1), fibFit(rC, [1.0], 0.15));
  } else if (rB > 1.05 && q[3] > q[1]) {
    pattern = "flat-expanded";
    fits.push(fibFit(rB, [1.236, 1.382], 0.15), fibFit(rC, [1.618, 1.0, 2.618], 0.15));
  } else if (rB > 1.0 && q[3] < q[1]) {
    pattern = "flat-running";
    fits.push(fibFit(rB, [1.236, 1.382], 0.15), fibFit(rC, [0.618, 0.786], 0.15));
  } else return null;
  const rules: RuleResult[] = [
    { name: "B retraciert mindestens 90 % von A", passed: rB >= 0.9, hard: true },
    { name: "C ist eine vollständige Bewegung (≥ 50 % von A)", passed: rC >= 0.5, hard: true },
  ];
  if (!hardOk(rules)) return null;
  return {
    pattern,
    direction: d,
    labels: ["A", "B", "C"],
    rules,
    fib: avg(fits) * 0.95,
    notes: pattern === "flat-running" ? ["Running Flat signalisiert starken übergeordneten Trend."] : [],
  };
}

/** Dreieck A-B-C-D-E (3-3-3-3-3). */
export function evalTriangle(pv: Pivot[]): PatternEval | null {
  if (pv.length !== 6) return null;
  const d = dirOf(pv);
  const q = pv.map((x) => x.price * d);
  const L = lens(pv);
  const contracting = L[1] < L[0] && L[2] < L[1] && L[3] < L[2] && L[4] < L[3];
  const expanding = L[1] > L[0] && L[2] > L[1] && L[3] > L[2] && L[4] > L[3];
  if (!contracting && !expanding) return null;
  const rules: RuleResult[] = contracting
    ? [
        { name: "Jede Welle kürzer als die vorherige", passed: true, hard: true },
        { name: "C endet nicht jenseits des Endes von A", passed: q[3] < q[1], hard: true },
        { name: "D endet nicht jenseits des Endes von B", passed: q[4] > q[2], hard: true },
        { name: "E endet nicht jenseits des Endes von C", passed: q[5] < q[3], hard: true },
      ]
    : [{ name: "Jede Welle länger als die vorherige", passed: true, hard: true }];
  if (!hardOk(rules)) return null;
  const ratios = [L[1] / L[0], L[2] / L[1], L[3] / L[2], L[4] / L[3]];
  const fits = ratios.map((r) => fibFit(r, contracting ? [0.618, 0.786] : [1.236, 1.618], 0.18));
  return {
    pattern: contracting ? "triangle-contracting" : "triangle-expanding",
    direction: d,
    labels: ["A", "B", "C", "D", "E"],
    rules,
    fib: avg(fits) * (expanding ? 0.85 : 1),
    notes: [],
  };
}

// ---------------------------------------------------------------- Komplexe Korrekturen

type Leg = { kind: "zigzag" | "flat" | "triangle"; ev: PatternEval };

function evalThreeLeg(pv: Pivot[]): Leg | null {
  const z = evalZigzag(pv);
  const f = evalFlat(pv);
  if (z && (!f || z.fib >= f.fib)) return { kind: "zigzag", ev: z };
  if (f) return { kind: "flat", ev: f };
  return null;
}

/**
 * Verkettete Korrekturen: W-X-Y (8 Pivots, Y optional Dreieck → 10) und W-X-Y-X-Z (12 Pivots).
 * Nur Zigzags → Double/Triple Zigzag, sonst Kombination.
 */
export function evalComplex(pv: Pivot[]): PatternEval | null {
  const segs = pv.length - 1;
  const d = dirOf(pv);
  const legs: Leg[] = [];
  const xs: number[] = [];
  let i = 0;
  const shape = segs === 7 ? [3, 3] : segs === 9 ? [3, 5] : segs === 11 ? [3, 3, 3] : null;
  if (!shape) return null;
  for (let k = 0; k < shape.length; k++) {
    const len = shape[k];
    const slice = pv.slice(i, i + len + 1);
    let leg: Leg | null = null;
    if (len === 3) leg = evalThreeLeg(slice);
    else {
      const t = evalTriangle(slice);
      if (t) leg = { kind: "triangle", ev: t };
    }
    if (!leg || leg.ev.direction !== d) return null;
    legs.push(leg);
    i += len;
    if (k < shape.length - 1) {
      xs.push(i);
      i += 1; // X-Welle
    }
  }
  const q = pv.map((x) => x.price * d);
  const rules: RuleResult[] = [];
  const fits: number[] = [];
  for (const xi of xs) {
    // X ist die Bewegung von pv[xi] nach pv[xi+1]
    const prevStart = q[xi - 3];
    rules.push({ name: "X-Welle retraciert die vorherige Korrektur nicht vollständig", passed: q[xi + 1] > prevStart, hard: true });
    const r = (q[xi] - q[xi + 1]) / (q[xi] - prevStart);
    fits.push(fibFit(r, [0.382, 0.5, 0.618, 0.786], 0.2));
  }
  // Jede Folgekorrektur muss das Ende der vorherigen überschreiten (Fortschritt).
  rules.push({ name: "Jede Teilkorrektur erzielt neues Extrem", passed: q[q.length - 1] > q[xs[xs.length - 1]], hard: true });
  if (!hardOk(rules)) return null;
  fits.push(...legs.map((l) => l.ev.fib));
  const allZig = legs.every((l) => l.kind === "zigzag");
  const pattern: PatternType = allZig
    ? segs === 7
      ? "double-zigzag"
      : segs === 11
        ? "triple-zigzag"
        : "combination-wxy"
    : segs === 11
      ? "combination-wxyxz"
      : "combination-wxy";
  if (allZig && segs === 9) return null; // Zigzag + Dreieck ist eine Kombination, oben abgedeckt
  const labels: string[] = [];
  const names = shape.length === 2 ? ["W", "Y"] : ["W", "Y", "Z"];
  shape.forEach((len, k) => {
    const sub = len === 3 ? ["a", "b", "c"] : ["a", "b", "c", "d", "e"];
    sub.forEach((s, j) => labels.push(j === len - 1 ? `${names[k]}` : `${s}`));
    if (k < shape.length - 1) labels.push("X");
  });
  return {
    pattern,
    direction: d,
    labels,
    rules,
    fib: avg(fits),
    notes: legs.map((l, k) => `${names[k]}: ${l.kind === "zigzag" ? "Zigzag" : l.kind === "flat" ? "Flat" : "Dreieck"}`),
  };
}
