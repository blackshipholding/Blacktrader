import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS, type LearnableParams } from "../src/lib/analysis/params";
import { STEP_LIMIT, stepLimitErrors } from "../src/lib/trainer/moves";
import { RULES_A, RULES_B, RULES_C } from "../src/lib/trainer/rulebook";
import { runSession, newSession, type SessionIO } from "../src/lib/trainer/session";

const P = (x: Partial<LearnableParams>): LearnableParams => ({ ...DEFAULT_PARAMS, ...x });

describe("Regelwerk C1: kleine Schritte", () => {
  it("2 Lernschritte je Stellschraube erlaubt, 3 nicht", () => {
    expect(stepLimitErrors(DEFAULT_PARAMS, P({ zoneAtrMult: 5 }))).toEqual([]);
    expect(stepLimitErrors(DEFAULT_PARAMS, P({ zoneAtrMult: 5.5 })).join()).toContain("zu großer Schritt");
  });
  it("höchstens 3 Stellschrauben auf einmal", () => {
    expect(stepLimitErrors(DEFAULT_PARAMS, P({ zoneAtrMult: 4.5, minStrength: 5, elliottAgreement: 5 }))).toEqual([]);
    expect(stepLimitErrors(DEFAULT_PARAMS, P({ zoneAtrMult: 4.5, minStrength: 5, elliottAgreement: 5, wave5Filter: 1 })).join()).toContain("zu viele");
  });
  it("Gewichtung höchstens ±10 Punkte, Wellengrade höchstens zwei 15-%-Schritte", () => {
    expect(stepLimitErrors(DEFAULT_PARAMS, P({ weights: { elliott: 70, fundamental: 15, volume: 15 } }))).toEqual([]);
    const w = DEFAULT_PARAMS.weights;
    expect(stepLimitErrors(DEFAULT_PARAMS, P({ weights: { ...w, elliott: w.elliott + 15, volume: w.volume - 15 } })).join()).toContain("Gewichtung");
    expect(stepLimitErrors(DEFAULT_PARAMS, P({ elliottDegrees: [1.5 * 1.3, 2.5, 4] }))).toEqual([]);
    expect(stepLimitErrors(DEFAULT_PARAMS, P({ elliottDegrees: [1.5 * 1.5, 2.5, 4] })).join()).toContain("Wellengrade");
    expect(STEP_LIMIT.maxKeys).toBe(3);
  });
});

describe("Regelwerk: Inhalt", () => {
  it("A1–A5, B1–B7, C1–C4", () => {
    expect(RULES_A.map((r) => r.id)).toEqual(["A1", "A2", "A3", "A4", "A5"]);
    expect(RULES_B.map((r) => r.id)).toEqual(["B1", "B2", "B3", "B4", "B5", "B6", "B7"]);
    expect(RULES_C.map((r) => r.id)).toEqual(["C1", "C2", "C3", "C4"]);
    expect(RULES_A[0].text).toContain("60 %");
    expect(RULES_A[2].text).toContain("8.000 €");
  });
});

describe("Regelwerk B7: Turnier-Veto beim Speichern", () => {
  it("ein vom Turnier abgelehnter Stand wird nicht gespeichert und nur einmal geprüft", async () => {
    const { candlesFromWaypoints } = await import("./helpers");
    const pts = Array.from({ length: 40 }, (_, i) => 100 + (i % 2 ? 30 : -20) + i * 3);
    const candles = candlesFromWaypoints(pts, 25);
    let vetoCalls = 0;
    let saved = 0;
    const io: SessionIO = {
      load: async () => candles,
      onProgress: () => {},
      onCellDone: () => {},
      shouldStop: () => false,
      onImprovement: async () => (saved++, true),
      tournamentVeto: async () => (vetoCalls++, "im Turnier schlechter"),
    };
    const st = newSession({ id: "1", durationMs: 4000, cells: ["stock:medium"], baseVersion: 0, paramSet: {}, extra: [], baseParams: {} });
    let t = 0;
    await runSession(st, { ...io, now: () => (t += 50) });
    expect(saved).toBe(0);
    // Wenn es überhaupt einen Kandidaten gab, wurde er genau einmal geprüft
    expect(vetoCalls).toBe(Object.keys(st.vetoed ?? {}).length);
    if (vetoCalls) expect(st.b7?.rejected).toBe(vetoCalls);
  });
});
