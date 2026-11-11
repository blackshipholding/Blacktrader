import { describe, expect, it } from "vitest";
import { atr, ema, obv, relativeVolume, rsi, rsiDivergences, sma, volumeProfile } from "../src/lib/analysis/indicators";
import { candlesFromWaypoints } from "./helpers";

describe("RSI (Wilder)", () => {
  // Referenzwerte aus Wilders klassischem Beispiel (häufig zitiert, z. B. StockCharts)
  const closes = [
    44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.0, 46.03, 46.41, 46.22, 45.64,
  ];
  it("stimmt mit Referenzwerten überein", () => {
    const r = rsi(closes, 14);
    expect(r[13]).toBeNull();
    expect(r[14]).toBeCloseTo(70.5, 0);
    expect(r[15]).toBeCloseTo(66.3, 0);
    expect(r[16]).toBeCloseTo(66.5, 0);
    expect(r[19]).toBeCloseTo(57.92, 0);
  });
  it("liefert 100 bei nur steigenden und 0 bei nur fallenden Kursen", () => {
    const up = Array.from({ length: 30 }, (_, i) => 100 + i);
    const down = Array.from({ length: 30 }, (_, i) => 100 - i);
    expect(rsi(up)[29]).toBe(100);
    expect(rsi(down)[29]).toBe(0);
  });
  it("bleibt im Bereich 0…100", () => {
    const c = candlesFromWaypoints([100, 130, 90, 140, 80], 15).map((x) => x.close);
    for (const v of rsi(c)) if (v != null) expect(v).toBeGreaterThanOrEqual(0), expect(v).toBeLessThanOrEqual(100);
  });
});

describe("Gleitende Durchschnitte, ATR, OBV", () => {
  it("SMA und EMA", () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
    const e = ema([1, 2, 3, 4, 5], 3);
    expect(e[2]).toBe(2);
    expect(e[3]).toBeCloseTo(3);
  });
  it("ATR ist positiv", () => {
    const c = candlesFromWaypoints([100, 120, 100], 20, 0.01);
    const a = atr(c);
    expect(a[a.length - 1]!).toBeGreaterThan(0);
  });
  it("OBV summiert Volumen nach Richtung", () => {
    const c = [100, 101, 100, 102].map((close, i) => ({ time: i, open: close, high: close, low: close, close, volume: 10 }));
    expect(obv(c)).toEqual([0, 10, 0, 10]);
  });
  it("relatives Volumen", () => {
    const c = Array.from({ length: 25 }, (_, i) => ({ time: i, open: 1, high: 1, low: 1, close: 1, volume: i === 24 ? 300 : 100 }));
    expect(relativeVolume(c)).toBeCloseTo(3);
  });
});

describe("Volume Profile", () => {
  it("findet den Point of Control in der Handelszone", () => {
    const c = [
      ...candlesFromWaypoints([100, 101, 100, 101, 100], 10, 0.001, 1, () => 5000),
      ...candlesFromWaypoints([100, 120], 10, 0.001, 2, () => 100),
    ];
    const vp = volumeProfile(c, 20)!;
    expect(vp.poc).toBeGreaterThan(99);
    expect(vp.poc).toBeLessThan(102);
    expect(vp.highVolumeZones.length).toBeGreaterThan(0);
    expect(vp.valueAreaLow).toBeLessThanOrEqual(vp.poc);
  });
});

describe("RSI-Divergenzen", () => {
  it("erkennt bärische Divergenz (höheres Hoch, schwächerer RSI)", () => {
    const c = candlesFromWaypoints([100, 104, 98, 130, 115, 133, 120], 12, 0.0005);
    const divs = rsiDivergences(c, rsi(c.map((x) => x.close)), 80);
    expect(divs.some((d) => d.type === "bearish")).toBe(true);
  });
});
