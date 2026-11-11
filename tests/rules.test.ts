import { describe, expect, it } from "vitest";
import { openPaperTrade } from "../src/lib/client/autotrade";
import { analyze } from "../src/lib/analysis/analyze";
import { decideSignal, MIN_RISK_REWARD } from "../src/lib/analysis/score";
import { candlesFromWaypoints } from "./helpers";

describe("Kein Einstieg = kein Trade", () => {
  it("Mindest-Chance-Risiko bleibt bei 1,5", () => {
    expect(MIN_RISK_REWARD).toBe(1.5);
  });
  it("ohne Signal wird kein Papier-Trade eröffnet", () => {
    const res = analyze({ symbol: "T", name: "T", candles: candlesFromWaypoints([100, 101, 100, 101, 100, 101], 10, 0.001), horizon: "medium", interval: "1d" })!;
    const neutral = { ...res, decision: { level: "neutral" as const, rawLevel: "neutral" as const, vetoes: [] } };
    expect(openPaperTrade({ kind: "stock", symbol: "T", name: "T" }, neutral)).toBe(false);
    expect(openPaperTrade({ kind: "stock", symbol: "T", name: "T" }, { ...res, plan: null, decision: { level: "buy", rawLevel: "buy", vetoes: [] } })).toBe(false);
  });
  it("ein starker Score ohne gutes Chance-Risiko bleibt neutral", () => {
    const plan = { direction: "long" as const, entry: 100, stop: 90, targets: [105], riskReward: 0.5 };
    expect(decideSignal(90, { elliottConfidence: 1, contested: false, plan }).level).toBe("neutral");
  });
});

describe("Trendfilter", () => {
  it("im klaren Abwärtstrend kein Kaufsignal", () => {
    const pts: number[] = [];
    for (let i = 0; i < 30; i++) pts.push(300 - i * 8 + (i % 2 ? 6 : 0));
    const c = candlesFromWaypoints(pts, 12, 0.003, 9);
    for (let end = 250; end <= c.length; end += 10) {
      const r = analyze({ symbol: "T", name: "T", candles: c.slice(0, end), horizon: "medium", interval: "1d" });
      if (r) expect(r.decision.level.includes("buy")).toBe(false);
    }
  });
  it("Stop liegt mindestens 2 ATR vom Einstieg entfernt", async () => {
    const { buildPlan } = await import("../src/lib/analysis/score");
    const plan = buildPlan({ bias: 1, stop: 99, targets: [120] } as never, 100, 4)!;
    expect(plan.stop).toBe(96);
  });
});
