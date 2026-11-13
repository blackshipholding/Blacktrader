import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS } from "../src/lib/analysis/params";
import { retestOnSeries } from "../src/lib/trainer/retest";
import { candidateMoves } from "../src/lib/trainer/moves";
import { stepLimitErrors } from "../src/lib/trainer/moves";

function walk(seed: number, n = 900) {
  let x = seed;
  const r = () => ((x = (x * 1664525 + 1013904223) % 4294967296) / 4294967296);
  let p = 100;
  return Array.from({ length: n }, (_, i) => {
    const o = p;
    p *= 1 + (r() - 0.49) * 0.03 + Math.sin(i / 25) * 0.004;
    const hi = Math.max(o, p) * (1 + r() * 0.01);
    const lo = Math.min(o, p) * (1 - r() * 0.01);
    return { time: 1_500_000_000 + i * 86400, open: o, high: hi, low: lo, close: p, volume: 1e6 };
  });
}

describe("Nachprüfung", () => {
  it("rechnet auf Testdaten ohne Fehler und liefert eine nachvollziehbare Entscheidung", () => {
    const series = [1, 2, 3].map((s) => ({ name: `T${s}`, kind: "stock" as const, horizon: "medium" as const, interval: "1d" as const, candles: walk(s), step: 2 }));
    const r = retestOnSeries(series, DEFAULT_PARAMS, { ...DEFAULT_PARAMS, zoneAtrMult: 4.5 });
    expect(typeof r.pass).toBe("boolean");
    expect(r.base.zones).toBeGreaterThanOrEqual(0);
    expect(r.note.length).toBeGreaterThan(5);
    // gleicher Stand gegen sich selbst: nie "besser"
    expect(retestOnSeries(series, DEFAULT_PARAMS, DEFAULT_PARAMS).pass).toBe(false);
  });
  it("mehr Kandidaten, alle innerhalb der Regeln (kleine Schritte)", () => {
    // Ausgangsstand (Filter aus): 13 Kandidaten; sobald Filter aktiv sind, rund 100 – alle innerhalb der Regeln (C1)
    const moves = candidateMoves(DEFAULT_PARAMS);
    expect(moves.length).toBeGreaterThanOrEqual(12);
    for (const mv of moves) expect(stepLimitErrors(DEFAULT_PARAMS, mv.params)).toEqual([]);
    const p2 = { ...DEFAULT_PARAMS, minStrength: 10 };
    const more = candidateMoves(p2);
    expect(more.length).toBeGreaterThan(60);
    for (const mv of more) expect(stepLimitErrors(p2, mv.params)).toEqual([]);
  });
});
