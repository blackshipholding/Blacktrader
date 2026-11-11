import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS } from "../src/lib/analysis/params";
import { backtestSeries, decide, primaryRate, withZones, type Metrics } from "../src/lib/trainer/engine";
import { initWF, keyOf, protocolOf, regionMetrics, type WFState } from "../src/lib/trainer/walkforward";
import { randomWalk } from "./golden/fixtures";

const m = (o: Partial<Metrics>): Metrics => ({ trades: 300, hitRate: 0.4, avgWin: 3, avgLoss: -2, profitFactor: 1.5, maxDrawdown: -10, perMonth: 4, ...o });

describe("Zonen-Quote wie HKCM im Trainer", () => {
  it("ist das Hauptmaß, wenn Zonen gemessen wurden", () => {
    expect(primaryRate(withZones(m({}), [1, 1, 0, 1]))).toBe(0.75);
    expect(primaryRate(m({ hitRate: 0.42 }))).toBe(0.42); // ältere Messung ohne Zonen
  });
  it("übernimmt nur bei höherer Zonen-Quote – alle Strenge-Regeln bleiben", () => {
    const ok = Array.from({ length: 250 }, (_, i) => (i % 10 < 7 ? 1 : 0));
    const base = withZones(m({}), ok.map((x, i) => (i % 10 < 6 ? 1 : 0)));
    expect(decide(base, withZones(m({}), ok)).accept).toBe(true);
    expect(decide(base, withZones(m({ profitFactor: 1.2 }), ok)).accept).toBe(false); // PF gesunken
    expect(decide(base, withZones(m({}), ok.slice(0, 100))).reasons.join()).toMatch(/zu wenige Zonen/);
  });
  it("Backtest liefert je neue Zone ein Ergebnis (nur Kerzen nach dem Signal)", () => {
    const c = randomWalk(5, 900);
    const r = backtestSeries({ name: "X", kind: "stock", horizon: "medium", interval: "1d", candles: c }, DEFAULT_PARAMS, { step: 2 });
    for (const z of r.zones) expect(z.at).toBeGreaterThan(z.t);
    const cut = backtestSeries({ name: "X", kind: "stock", horizon: "medium", interval: "1d", candles: c.slice(0, 700) }, DEFAULT_PARAMS, { step: 2 });
    const early = (zs: typeof r.zones) => zs.filter((z) => z.at < c[699].time);
    expect(early(cut.zones)).toEqual(early(r.zones));
  });
  it("Lerndaten enthalten nur Zonen, deren Ergebnis vor dem Prüfbeginn feststand", () => {
    const st = initWF("stock:medium", [{ symbol: "A", kind: "stock", horizon: "medium", interval: "1d", days: 0, step: 1 }], DEFAULT_PARAMS, { folds: 1 }) as WFState;
    st.info = [{ start: 0, bounds: [100, 200] }];
    st.pool[keyOf(DEFAULT_PARAMS)].runs = [{ r: [], en: [], ex: [], zt: [10, 90, 150], za: [20, 120, 160], zo: [1, 1, 0], zd: [1, 1, 1], zp: [1, 1, 1], zb: [0, 0, 0] }];
    expect(regionMetrics(st, st.baseKey, { kind: "train", k: 0 })?.zones).toBe(1); // Zone bei 90 endet erst bei 120 → nicht in den Lerndaten
    expect(regionMetrics(st, st.baseKey, { kind: "test", k: 0 })?.zones).toBe(1);
    expect(protocolOf(st, [st.baseKey]).map((e) => e.t)).toEqual([150]);
  });
});
