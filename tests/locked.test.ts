// Feste Werte: dürfen sich nie ändern und der Trainer darf sie nicht anfassen.
import { describe, expect, it } from "vitest";
import { LOCKED } from "../src/lib/analysis/locked-config";
import { DEFAULT_WEIGHTS, MIN_RISK_REWARD } from "../src/lib/analysis/score";
import { DEFAULT_ZONE_OPTIONS } from "../src/lib/analysis/zones";
import { DEFAULT_LONGTERM } from "../src/lib/analysis/longterm";
import { DEFAULT_PARAMS, LEARNABLE_KEYS, validateParams } from "../src/lib/analysis/params";

/** Erwarteter, unveränderlicher Stand. Jede Änderung hier muss bewusst und manuell erfolgen. */
const EXPECTED = {
  weights: { elliott: 60, fundamental: 20, volume: 20 },
  weightBounds: { elliottMin: 60, fundamentalMin: 10, volumeMin: 10, sum: 100 },
  minStrengthOnlyUp: true,
  acceptance: { minSignals: 200, maxSignalDrop: 0.4, profitFactorNotLower: true, drawdownNotWorse: true },
  minRiskReward: 1.5,
  zone: { entryRetrace: 0.618, zoneDeep: 0.786, bottomAboveStop: 0.01, stopBufferAtr: 0.25, minWaveAtr: 4, target1Ext: 0.272, trendFilter: true },
  trade: { exitMode: "trail", trailAtr: 4, maxWaitBars: 60, maxHoldBars: 200 },
  longterm: { atrMult: 6, minMoveAtr: 8, zoneTop: 0.618, zoneBottom: 0.886, tranches: 3 },
  riskBadgePct: 15,
  horizons: { short: ["5m", "15m", "1h"], medium: ["4h", "1d"], long: ["1w", "1M"] },
  signalKinds: { trade: "grün", short: "rot", longterm: "blau" },
};

describe("Feste Werte (locked-config)", () => {
  it("entsprechen exakt dem festgelegten Stand", () => {
    for (const [k, v] of Object.entries(EXPECTED)) expect((LOCKED as Record<string, unknown>)[k]).toEqual(v);
    expect(LOCKED.elliottRules).toHaveLength(3);
    expect(LOCKED.elliottPatterns).toHaveLength(13);
  });
  it("sind schreibgeschützt (auch verschachtelt)", () => {
    expect(Object.isFrozen(LOCKED)).toBe(true);
    expect(Object.isFrozen(LOCKED.zone)).toBe(true);
    expect(Object.isFrozen(LOCKED.weights)).toBe(true);
    expect(Object.isFrozen(LOCKED.weightBounds)).toBe(true);
    expect(() => {
      (LOCKED.weightBounds as { elliottMin: number }).elliottMin = 40;
    }).toThrow();
    expect(() => {
      (LOCKED.weights as { elliott: number }).elliott = 50;
    }).toThrow();
    expect(LOCKED.weights.elliott).toBe(60);
  });
  it("werden von den Analyse-Modulen verwendet", () => {
    expect(DEFAULT_WEIGHTS).toEqual(LOCKED.weights);
    expect(MIN_RISK_REWARD).toBe(LOCKED.minRiskReward);
    for (const k of Object.keys(LOCKED.zone) as (keyof typeof LOCKED.zone)[]) expect(DEFAULT_ZONE_OPTIONS[k]).toBe(LOCKED.zone[k]);
    expect(DEFAULT_LONGTERM.zoneTop).toBe(LOCKED.longterm.zoneTop);
    expect(DEFAULT_LONGTERM.zoneBottom).toBe(LOCKED.longterm.zoneBottom);
  });
  it("lernbare Werte überschneiden sich nicht mit festen Werten", () => {
    const lockedKeys = ["weightBounds", "acceptance", "minRiskReward", "entryRetrace", "zoneDeep", "bottomAboveStop", "stopBufferAtr", "minWaveAtr", "target1Ext", "trendFilter", "trailAtr", "exitMode", "maxWaitBars", "maxHoldBars", "minQuality", "riskBadgePct"];
    for (const k of lockedKeys) expect(LEARNABLE_KEYS as string[]).not.toContain(k);
    expect(validateParams({ weightBounds: { elliottMin: 40 } } as never)).toContain("Nicht lernbar: weightBounds");
    // Gewichtung ist lernbar, aber nur innerhalb der festen Grenzen
    expect(validateParams({ weights: { elliott: 50, fundamental: 30, volume: 20 } }).length).toBeGreaterThan(0);
    expect(validateParams({ minRiskReward: 1 } as never)).toContain("Nicht lernbar: minRiskReward");
    expect(validateParams({ trailAtr: 2 } as never)).toContain("Nicht lernbar: trailAtr");
    expect(validateParams(DEFAULT_PARAMS)).toEqual([]);
    expect(validateParams({ rsiOverbought: 95 })).toEqual(["rsiOverbought außerhalb 65–80"]);
  });
});
