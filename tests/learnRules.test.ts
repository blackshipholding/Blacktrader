import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS } from "../src/lib/analysis/params";
import { backtestSeries, passesChanceRules } from "../src/lib/trainer/engine";
import { randomWalk } from "./golden/fixtures";

describe("Option A: Lernen nur mit Chancen-Regeln", () => {
  it("Regel: mindestens 15 % Chance, Potenzial ab 26, keine Shorts", () => {
    expect(passesChanceRules("long", 100, 96, 125)).toBe(true); // Chance 25 %, Risiko 4 %
    expect(passesChanceRules("long", 100, 96, 110)).toBe(false); // nur 10 % Chance
    expect(passesChanceRules("long", 100, 80, 118)).toBe(false); // 18 % Chance, aber Potenzial zu klein (Risiko 20 %)
    expect(passesChanceRules("short", 100, 104, 75)).toBe(false); // keine Shorts
    expect(passesChanceRules("long", 100, undefined, undefined)).toBe(false);
  });
  it("mit Regeln nie mehr Zonen/Trades als ohne, und alle gezählten erfüllen die Regeln", () => {
    const s = { name: "T", kind: "stock" as const, horizon: "medium" as const, interval: "1d" as const, candles: randomWalk(5, 1400, 100, 0.03) };
    const all = backtestSeries(s, DEFAULT_PARAMS, { step: 3 });
    const ruled = backtestSeries(s, DEFAULT_PARAMS, { step: 3, rules: true });
    expect(ruled.zones.length).toBeLessThanOrEqual(all.zones.length);
    expect(ruled.trades.length).toBeLessThanOrEqual(all.trades.length);
    for (const t of ruled.trades) expect(passesChanceRules(t.direction, t.entry, t.stop, t.target)).toBe(true);
    expect(ruled.zones.every((z) => z.dir === 1)).toBe(true);
  });
});
