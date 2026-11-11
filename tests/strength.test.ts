import { describe, expect, it } from "vitest";
import { signalStrength } from "../src/components/AssetCard";
import type { AnalysisResult } from "../src/lib/analysis/analyze";

const res = (total: number, direction: "long" | "short" | null, level = "buy") =>
  ({ total, plan: direction ? { direction } : null, decision: { level } }) as unknown as AnalysisResult;

describe("Signalstärke (je höher, desto besser)", () => {
  it("Kauf = Gesamtscore, Short = 100 − Gesamtscore", () => {
    expect(signalStrength(res(72, "long"))).toBe(72);
    expect(signalStrength(res(30, "short", "sell"))).toBe(70);
  });
  it("kein Signal = keine Stärke", () => {
    expect(signalStrength(res(50, null, "neutral"))).toBeNull();
    expect(signalStrength(res(60, "long", "neutral"))).toBeNull();
  });
  it("ein starker Short steht vor einem schwachen Kauf", () => {
    expect(signalStrength(res(25, "short", "strong-sell"))!).toBeGreaterThan(signalStrength(res(58, "long"))!);
  });
});
