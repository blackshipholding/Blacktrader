import { describe, expect, it } from "vitest";
import { fxLookup, intervalForGap, stopTouched } from "../src/lib/analysis/missedStop";
import type { Candle } from "../src/lib/types";

const c = (time: number, low: number, high = low + 1): Candle => ({ time, open: low + 0.5, high, low, close: low + 0.5, volume: 1 });
const fxc = (time: number, close: number): Candle => ({ time, open: close, high: close, low: close, close, volume: 0 });

describe("Stop während Abwesenheit", () => {
  it("Euro-Stop mit Wechselkurs von damals: Dollar-Tief × Kurs", () => {
    // EURUSD 1,25 → 0,80 € je Dollar; Tief 100 $ = 80 €
    const fx = fxLookup([fxc(0, 1.25), fxc(7200, 1.1)], (x) => 1 / x);
    const candles = [c(0, 110), c(900, 101), c(1800, 100.2), c(9000, 120)];
    expect(stopTouched(candles, 80.5, fx, 0, 900)?.touched).toBe(true); // 100,2 $ × 0,8 = 80,16 € ≤ 80,5
    expect(stopTouched(candles, 79, fx, 0, 900)?.touched).toBe(false);
  });
  it("heutiger Kurs hätte anders entschieden: Kerze nimmt den Kurs ihrer Zeit", () => {
    const fx = fxLookup([fxc(0, 1.25), fxc(7200, 1.0)], (x) => 1 / x);
    // Kerze bei 9000 s: Kurs 1,0 → 120 $ = 120 €; Kerze bei 1800 s: 0,8 → 100 $ = 80 €
    expect(stopTouched([c(1800, 100)], 85, fx, 0, 900)?.touched).toBe(true);
    expect(stopTouched([c(9000, 100)], 85, fx, 0, 900)?.touched).toBe(false);
  });
  it("knapp berührt (0,3 %) und Zeit der ersten Berührung", () => {
    const one = () => 1;
    const r = stopTouched([c(0, 100.2)], 100, one, 0, 900)!;
    expect(r.touched).toBe(false);
    expect(r.near).toBe(true);
    const t = stopTouched([c(0, 105), c(900, 99), c(1800, 98)], 100, one, 0, 900)!;
    expect(t.touched).toBe(true);
    expect(t.at).toBe(900);
  });
  it("Kerzen vor dem letzten Besuch zählen nicht", () => {
    expect(stopTouched([c(0, 50), c(10000, 120)], 100, () => 1, 5000, 900)?.touched).toBe(false);
  });
  it("Euro-Werte: ohne Umrechnung; Short nimmt das Hoch", () => {
    expect(stopTouched([c(0, 90, 130)], 120, () => 1, 0, 900, -1)?.touched).toBe(true);
  });
  it("Kerzengröße nach Dauer", () => {
    expect(intervalForGap(2 * 86400e3, false)).toBe("15m");
    expect(intervalForGap(40 * 86400e3, false)).toBe("1h");
    expect(intervalForGap(400 * 86400e3, false)).toBe("1d");
    expect(intervalForGap(12 * 86400e3, true)).toBe("1h");
  });
});
