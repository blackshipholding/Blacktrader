// LERNBARE Stellschrauben (Trainer). Standardwerte = bisherige feste Werte → ohne Training identisches Verhalten.
// Gewichtung, Regeln und Risiko stehen in locked-config.ts und sind hier bewusst NICHT enthalten.
import type { AssetKind, Horizon } from "../types";
import { LOCKED } from "./locked-config";

export interface WeightSet {
  elliott: number;
  fundamental: number;
  volume: number;
}

export interface LearnableParams {
  /** ZigZag-Empfindlichkeit (ATR-Faktor) der Zielzonen */
  zoneAtrMult: number;
  /** ZigZag-Empfindlichkeit der drei Wellengrade (fein, mittel, grob) */
  elliottDegrees: [number, number, number];
  /** Breite der Fibonacci-Toleranzbänder (Faktor auf die Standardtoleranz) */
  fibToleranceScale: number;
  /** Ranking alternativer Zählungen: Gewicht der Fibo-Passung (Rest = Grundwert) */
  rankFibWeight: number;
  /** Ranking: Stärke des Kontext-Abschlags (0 = ignorieren, 1 = Standard) */
  rankContextStrength: number;
  /** RSI-Schwellen */
  rsiOverbought: number;
  rsiOversold: number;
  /** Wie frisch eine RSI-Divergenz sein muss (Kerzen) */
  divergenceRecentBars: number;
  /** Volumen: "starkes Volumen" ab relativem Volumen */
  relVolHigh: number;
  /** Volumen: Ausbruch gilt als bestätigt ab relativem Volumen */
  relVolBreakout: number;
  /** Volumen: "dünnes Volumen" unter relativem Volumen */
  relVolLow: number;
  /** Gewichte einzelner Fundamental-Kennzahlen INNERHALB der 20 % (Name → Gewicht) */
  fundamentalWeights: Record<string, number>;
  /** Anteil der News am Fundamental/News-Teil (Rest = Kennzahlen), INNERHALB der 20 % */
  newsShare: number;
  /** Halbwertszeit der News-Gewichtung in Stunden */
  newsHalfLifeHours: number;
  /** Mindest-Signalstärke (0–100), ab der ein Signal angezeigt wird (0 = alle). Darf nur steigen. */
  minStrength: number;
  /** Gewichtung (Summe 100, Elliott ≥ 60, Fundamental ≥ 10, Volumen ≥ 10 – siehe LOCKED.weightBounds) */
  weights: WeightSet;
  /** Wellenbild muss die Richtung bestätigen: Elliott-Teilscore ≥ 50 + x (Kauf) bzw. ≤ 50 − x (Short); 0 = aus */
  elliottAgreement: number;
  /** 1 = kein Einstieg, wenn Welle 5 gerade endet (fertiger Impuls oder Divergenz am Extrem) */
  wave5Filter: number;
  /** 1 = übergeordnete Zeitebene darf der Richtung nicht widersprechen */
  htfConfirm: number;
  /** 1 = nach Ziel 1 aussteigen, wenn ein Wellen-5-Ende mit Divergenz erkannt wird (nur Gewinnsicherung) */
  wave5Exit: number;
}

export const DEFAULT_PARAMS: LearnableParams = Object.freeze({
  zoneAtrMult: 4,
  elliottDegrees: [1.5, 2.5, 4] as [number, number, number],
  fibToleranceScale: 1,
  rankFibWeight: 0.65,
  rankContextStrength: 1,
  rsiOverbought: 70,
  rsiOversold: 30,
  divergenceRecentBars: 20,
  relVolHigh: 1.5,
  relVolBreakout: 1.3,
  relVolLow: 0.6,
  fundamentalWeights: {},
  newsShare: 0.4,
  newsHalfLifeHours: 36,
  minStrength: 0,
  weights: { ...LOCKED.weights },
  elliottAgreement: 0,
  wave5Filter: 0,
  htfConfirm: 0,
  wave5Exit: 0,
}) as LearnableParams;

/** Erlaubte Bereiche (der Trainer darf nur innerhalb dieser Grenzen und nur diese Schlüssel verändern). */
export const PARAM_BOUNDS: Record<Exclude<keyof LearnableParams, "fundamentalWeights" | "elliottDegrees" | "weights">, [number, number]> = {
  zoneAtrMult: [2.5, 6],
  fibToleranceScale: [0.6, 1.6],
  rankFibWeight: [0.4, 0.85],
  rankContextStrength: [0, 1.5],
  rsiOverbought: [65, 80],
  rsiOversold: [20, 35],
  divergenceRecentBars: [10, 40],
  relVolHigh: [1.2, 2.2],
  relVolBreakout: [1.1, 2],
  relVolLow: [0.4, 0.8],
  newsShare: [0.2, 0.6],
  newsHalfLifeHours: [12, 72],
  minStrength: [0, 70],
  elliottAgreement: [0, 30],
  wave5Filter: [0, 1],
  htfConfirm: [0, 1],
  wave5Exit: [0, 1],
};

/** Prüft eine Gewichtung gegen die festen Grenzen. */
export function validateWeights(w: unknown): string[] {
  const b = LOCKED.weightBounds;
  if (!w || typeof w !== "object") return ["Gewichtung ungültig"];
  const { elliott, fundamental, volume } = w as WeightSet;
  if (![elliott, fundamental, volume].every((x) => typeof x === "number" && Number.isFinite(x))) return ["Gewichtung ungültig"];
  const e: string[] = [];
  if (Math.abs(elliott + fundamental + volume - b.sum) > 0.01) e.push(`Gewichtung muss ${b.sum} % ergeben`);
  if (elliott < b.elliottMin) e.push(`Elliott-Wellen mindestens ${b.elliottMin} %`);
  if (fundamental < b.fundamentalMin) e.push(`Fundamental & News mindestens ${b.fundamentalMin} %`);
  if (volume < b.volumeMin) e.push(`Volumen & RSI mindestens ${b.volumeMin} %`);
  return e;
}

/** Bringt eine Gewichtung in die festen Grenzen (Regler in den Einstellungen): der bewegte Regler bleibt, die anderen gleichen aus. */
export function clampWeights(w: WeightSet, changed: keyof WeightSet = "elliott"): WeightSet {
  const b = LOCKED.weightBounds;
  const min: WeightSet = { elliott: b.elliottMin, fundamental: b.fundamentalMin, volume: b.volumeMin };
  const others = (["elliott", "fundamental", "volume"] as (keyof WeightSet)[]).filter((k) => k !== changed);
  const out = { ...min };
  out[changed] = Math.min(Math.max(Math.round(w[changed]), min[changed]), b.sum - others.reduce((a, k) => a + min[k], 0));
  const rest = b.sum - out[changed] - others.reduce((a, k) => a + min[k], 0);
  const extra = others.map((k) => Math.max(0, (w[k] ?? 0) - min[k]));
  const total = extra[0] + extra[1];
  const first = total > 0 ? Math.round((rest * extra[0]) / total) : Math.round(rest / 2);
  out[others[0]] = min[others[0]] + first;
  out[others[1]] = min[others[1]] + rest - first;
  return out;
}

export const LEARNABLE_KEYS = Object.keys(DEFAULT_PARAMS) as (keyof LearnableParams)[];

/** Parameter je Anlageklasse und Horizont (z. B. "crypto:short"). */
export type ParamSet = Partial<Record<`${AssetKind}:${Horizon}`, Partial<LearnableParams>>>;

/** Wählt die Parameter für Klasse + Horizont (fehlende Werte = Standard). */
export function resolveParams(set: ParamSet | null | undefined, kind?: AssetKind, horizon?: Horizon): LearnableParams {
  const own = kind && horizon ? set?.[`${kind}:${horizon}`] : undefined;
  return { ...DEFAULT_PARAMS, ...(own ?? {}) };
}

/** Prüft einen Parametersatz: nur erlaubte Schlüssel, nur erlaubte Bereiche. */
export function validateParams(p: Partial<LearnableParams>): string[] {
  const errors: string[] = [];
  for (const [k, v] of Object.entries(p)) {
    if (!LEARNABLE_KEYS.includes(k as keyof LearnableParams)) {
      errors.push(`Nicht lernbar: ${k}`);
      continue;
    }
    const b = (PARAM_BOUNDS as Record<string, [number, number]>)[k];
    if (b && (typeof v !== "number" || v < b[0] || v > b[1])) errors.push(`${k} außerhalb ${b[0]}–${b[1]}`);
    if (k === "elliottDegrees" && (!Array.isArray(v) || v.length !== 3 || v.some((x) => x < 1 || x > 7) || !(v[0] < v[1] && v[1] < v[2]))) errors.push("elliottDegrees ungültig");
    if (k === "weights") errors.push(...validateWeights(v));
    if (["wave5Filter", "htfConfirm", "wave5Exit"].includes(k) && v !== 0 && v !== 1) errors.push(`${k} muss 0 oder 1 sein`);
    if (k === "fundamentalWeights" && (typeof v !== "object" || Object.values(v as object).some((x) => typeof x !== "number" || x < 0 || x > 3))) errors.push("fundamentalWeights ungültig");
  }
  return errors;
}

/** Strenge-Prüfung gegenüber dem bisherigen Stand: Mindest-Signalstärke darf nur steigen. */
export function strictnessErrors(prev: LearnableParams, next: LearnableParams): string[] {
  const e: string[] = [];
  if (next.minStrength < prev.minStrength) e.push(`Mindest-Signalstärke darf nicht sinken (${prev.minStrength} → ${next.minStrength})`);
  return e;
}
