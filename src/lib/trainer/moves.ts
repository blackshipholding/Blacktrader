// Kleine Lernschritte. Strenge-Regler (Mindest-Signalstärke, Wellen-Bestätigung, Filter) dürfen nur strenger werden.
import { PARAM_BOUNDS, validateParams, type LearnableParams, type WeightSet } from "../analysis/params";

type NumKey = keyof typeof PARAM_BOUNDS;

const STEP: Record<NumKey, number> = {
  zoneAtrMult: 0.5,
  fibToleranceScale: 0.15,
  rankFibWeight: 0.05,
  rankContextStrength: 0.25,
  rsiOverbought: 3,
  rsiOversold: 3,
  divergenceRecentBars: 5,
  relVolHigh: 0.15,
  relVolBreakout: 0.15,
  relVolLow: 0.1,
  newsShare: 0.1,
  newsHalfLifeHours: 12,
  minStrength: 5,
  elliottAgreement: 5,
  wave5Filter: 1,
  htfConfirm: 1,
  wave5Exit: 1,
};

/** Nur nach oben (strenger): */
export const ONLY_UP: NumKey[] = ["minStrength", "elliottAgreement", "wave5Filter", "htfConfirm", "wave5Exit"];

/** Welche Stellschrauben wirken bei diesem Stand überhaupt (sonst ändern sie kein Signal)? */
export function activeKeys(p: LearnableParams): { keys: NumKey[]; degrees: boolean; weights: boolean } {
  const keys: NumKey[] = ["zoneAtrMult", "minStrength", "elliottAgreement", "wave5Filter", "htfConfirm", "wave5Exit"];
  const usesScore = p.minStrength > 0;
  const usesElliott = usesScore || p.elliottAgreement > 0 || p.wave5Filter > 0;
  if (usesElliott) keys.push("fibToleranceScale", "rankFibWeight", "rankContextStrength");
  if (usesScore) keys.push("rsiOverbought", "rsiOversold", "relVolHigh", "relVolBreakout", "relVolLow");
  if (usesScore || p.wave5Filter > 0) keys.push("divergenceRecentBars");
  return { keys, degrees: usesElliott, weights: usesScore };
}

export function candidateMoves(p: LearnableParams): { params: LearnableParams; change: string }[] {
  const out: { params: LearnableParams; change: string }[] = [];
  const { keys, degrees, weights } = activeKeys(p);
  for (const k of keys) {
    const [lo, hi] = PARAM_BOUNDS[k];
    for (const dir of ONLY_UP.includes(k) ? [1] : [-1, 1]) {
      const v = Math.round((p[k] + dir * STEP[k]) * 1000) / 1000;
      if (v < lo || v > hi) continue;
      const params = { ...p, [k]: v };
      if (!validateParams(params).length) out.push({ params, change: `${k} ${p[k]} → ${v}` });
    }
  }
  if (degrees) {
    for (const f of [0.85, 1.15]) {
      const d = p.elliottDegrees.map((x) => Math.round(x * f * 100) / 100) as [number, number, number];
      const params = { ...p, elliottDegrees: d };
      if (!validateParams(params).length) out.push({ params, change: `Wellengrade ${p.elliottDegrees.join("/")} → ${d.join("/")}` });
    }
  }
  if (weights) {
    const ks: (keyof WeightSet)[] = ["elliott", "fundamental", "volume"];
    for (const to of ks)
      for (const from of ks) {
        if (to === from) continue;
        const w = { ...p.weights, [to]: p.weights[to] + 5, [from]: p.weights[from] - 5 };
        const params = { ...p, weights: w };
        if (!validateParams(params).length) out.push({ params, change: `Gewichtung ${p.weights.elliott}/${p.weights.fundamental}/${p.weights.volume} → ${w.elliott}/${w.fundamental}/${w.volume}` });
      }
  }
  return out;
}

/**
 * Regelwerk C1 – kleine Schritte: Ein gespeicherter neuer Stand darf sich vom bisherigen höchstens um 2 Lernschritte je
 * Stellschraube unterscheiden (Gewichtung höchstens ±10 Punkte, Wellengrade höchstens ±32 %) und höchstens 3 Stellschrauben
 * auf einmal ändern. Ein-/Aus-Schalter zählen als ein Schritt.
 */
export const STEP_LIMIT = { stepsPerKey: 2, maxKeys: 3, weightPoints: 10, degreeFactor: 1.15 * 1.15 } as const;

export function stepLimitErrors(prev: LearnableParams, next: LearnableParams): string[] {
  const e: string[] = [];
  let changed = 0;
  for (const k of Object.keys(STEP) as NumKey[]) {
    const a = prev[k];
    const b = next[k];
    if (typeof a !== "number" || typeof b !== "number" || Math.abs(a - b) < 1e-9) continue;
    changed++;
    if (Math.abs(a - b) > STEP[k] * STEP_LIMIT.stepsPerKey + 1e-9) e.push(`zu großer Schritt bei ${k} (${a} → ${b}, höchstens ${STEP_LIMIT.stepsPerKey} Lernschritte)`);
  }
  if (JSON.stringify(prev.elliottDegrees) !== JSON.stringify(next.elliottDegrees)) {
    changed++;
    if (prev.elliottDegrees.some((x, i) => { const f = next.elliottDegrees[i] / x; return f > STEP_LIMIT.degreeFactor + 1e-6 || f < 1 / STEP_LIMIT.degreeFactor - 1e-6; })) e.push(`zu großer Schritt bei den Wellengraden (${prev.elliottDegrees.join("/")} → ${next.elliottDegrees.join("/")})`);
  }
  if (JSON.stringify(prev.weights) !== JSON.stringify(next.weights)) {
    changed++;
    if ((["elliott", "fundamental", "volume"] as (keyof WeightSet)[]).some((k) => Math.abs(prev.weights[k] - next.weights[k]) > STEP_LIMIT.weightPoints)) e.push(`zu großer Schritt bei der Gewichtung (höchstens ±${STEP_LIMIT.weightPoints} Punkte)`);
  }
  if (changed > STEP_LIMIT.maxKeys) e.push(`zu viele Stellschrauben auf einmal (${changed}, höchstens ${STEP_LIMIT.maxKeys})`);
  return e;
}
