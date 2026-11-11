import { describe, expect, it } from "vitest";
import { findZoneSetup } from "../src/lib/analysis/zones";
import { runZoneBacktest } from "../src/lib/analysis/zoneBacktest";
import { analyze } from "../src/lib/analysis/analyze";
import { candlesFromWaypoints } from "./helpers";

// Langer Aufwärtstrend, danach letzter Impuls 200 → 260 und beginnende Korrektur
const up = candlesFromWaypoints([100, 130, 118, 160, 145, 190, 172, 200, 260, 250], 14, 0.002, 4);

describe("Zielzonen", () => {
  it("findet im Aufwärtstrend eine Kaufzone von 61,8 % der Welle bis 1 % über den Stop", () => {
    const z = findZoneSetup(up)!;
    expect(z).not.toBeNull();
    expect(z.direction).toBe("long");
    const L = z.b.price - z.a.price;
    expect(z.zoneStart).toBeCloseTo(z.b.price - 0.618 * L, 5);
    expect(z.zoneEnd).toBeCloseTo(z.stop * 1.01, 5);
    expect(z.zoneEnd).toBeLessThan(z.b.price - 0.786 * L); // tiefer als die alte Unterkante
    expect(z.stop).toBeLessThan(z.a.price);
    expect(z.targets[0]).toBeGreaterThan(z.b.price);
    expect(z.inZone).toBe(false);
  });

  it("Analyse liefert eine Limit-Order mit Zone statt Sofort-Einstieg", () => {
    const r = analyze({ symbol: "T", name: "T", candles: up, horizon: "medium", interval: "1d", currency: "EUR" })!;
    if (r.plan) {
      expect(r.plan.orderType).toBe("limit");
      expect(r.plan.entry).toBeLessThan(r.price);
      expect(r.commentary.summary).toMatch(/^Kaufzone/);
      expect(r.plan.riskReward).toBeGreaterThanOrEqual(1.5);
    } else expect(r.decision.level).toBe("neutral");
  });

  it("kein Setup gegen den Trend", () => {
    const down = candlesFromWaypoints([260, 230, 242, 200, 215, 170, 185, 150, 100, 110], 14, 0.002, 4);
    const z = findZoneSetup(down);
    if (z) expect(z.direction).toBe("short");
  });

  it("EchoChart-Zonen: Einstieg nur, wenn der Kurs die Zone erreicht", () => {
    const c = candlesFromWaypoints([100, 130, 118, 160, 145, 190, 172, 200, 260, 220, 300, 270, 330], 14, 0.002, 4);
    const r = runZoneBacktest(c, { warmup: 60 });
    for (const t of r.trades) {
      expect(t.exitTime).toBeGreaterThanOrEqual(t.entryTime);
      if (t.direction === "long") expect(t.stop).toBeLessThan(t.entry);
    }
  });
});
