import { describe, expect, it } from "vitest";
import { TARGET_HIT_RATE } from "../src/lib/trainer/engine";
import { classStanding, goalProgress, goalReached } from "../src/lib/trainer/goal";

const m = (hitRate: number, trades: number) => ({ trades, hitRate, avgWin: 1, avgLoss: -1, profitFactor: 1, maxDrawdown: 0, perMonth: 1 });

describe("Ziel 70 %", () => {
  it("Zielwert ist 70 %", () => expect(TARGET_HIT_RATE).toBe(0.7));
  it("Ziel erreicht erst ab 70 %", () => {
    expect(goalReached(0.69)).toBe(false);
    expect(goalReached(0.7)).toBe(true);
    expect(goalReached(0.65)).toBe(false);
  });
  it("Balken: 0 bis 70 %", () => {
    expect(goalProgress(0.35)).toBe(50);
    expect(goalProgress(0.8)).toBe(100);
    expect(goalProgress(null)).toBe(0);
  });
  it("Stand je Klasse nach Signalanzahl gewichtet, andere Klassen zählen nicht", () => {
    const cells = [
      { cell: "stock:short", status: { oos: m(0.6, 100) } },
      { cell: "stock:medium", status: { oos: m(0.3, 300) } },
      { cell: "crypto:short", status: { oos: m(0.9, 1000) } },
      { cell: "stock:long", status: null },
    ];
    expect(classStanding(cells, "stock").hitRate).toBeCloseTo(0.375);
    expect(classStanding(cells, "stock").trades).toBe(400);
    expect(classStanding(cells, "commodity").hitRate).toBeNull();
  });
});
