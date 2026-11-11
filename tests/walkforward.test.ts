import { describe, expect, it } from "vitest";
import { LOCKED } from "../src/lib/analysis/locked-config";
import { clampWeights, DEFAULT_PARAMS, strictnessErrors, validateParams, validateWeights } from "../src/lib/analysis/params";
import { decide, type Metrics } from "../src/lib/trainer/engine";
import { candidateMoves, ONLY_UP } from "../src/lib/trainer/moves";
import { advanceWF, initWF, seriesInfo } from "../src/lib/trainer/walkforward";
import type { Candle } from "../src/lib/types";
import { randomWalk } from "./golden/fixtures";

const spec = (i: number) => ({ symbol: `S${i}`, kind: "stock" as const, horizon: "medium" as const, interval: "1d" as const, days: 0, step: 5 });
const m = (o: Partial<Metrics>): Metrics => ({ trades: 300, hitRate: 0.5, avgWin: 3, avgLoss: -2, profitFactor: 1.5, maxDrawdown: -10, perMonth: 4, ...o });

describe("Walk-Forward ohne Blick in die Zukunft", () => {
  it("die Auswahl für Fold 0 hängt nicht von Kursen nach dessen Prüfbeginn ab", async () => {
    const a = [randomWalk(71, 900), randomWalk(72, 900)];
    const info = seriesInfo(a[0].slice(0, a[0].length - 260), 4)!;
    const cut = info.bounds[0];
    // Gleich bis zum Prüfbeginn von Fold 0, danach völlig andere Kurse
    const other = a.map((c, i) => {
      const alt = randomWalk(500 + i, 900, c[0].close);
      return c.map((x, j) => (x.time < cut ? x : { ...alt[j], time: x.time }));
    });
    const run = async (data: Candle[][]) => {
      const st = initWF("stock:medium", [spec(0), spec(1)], DEFAULT_PARAMS, { folds: 4, maxSteps: 1, candidatesPerStep: 4 });
      await advanceWF(st, { load: async (s) => data[Number(s.symbol.slice(1))], deadline: Date.now() + 100_000 });
      return st;
    };
    const x = await run(a);
    const y = await run(other);
    expect(x.climbers[0]).toBe(y.climbers[0]);
  }, 120_000);
});

describe("Strenge", () => {
  it("lehnt ab, wenn der maximale Rückgang schlechter wird", () => {
    const d = decide(m({}), m({ hitRate: 0.6, maxDrawdown: -15 }));
    expect(d.accept).toBe(false);
    expect(d.reasons.join()).toMatch(/Rückgang/);
  });
  it("Strenge-Regler bewegen sich nur nach oben", () => {
    const p = { ...DEFAULT_PARAMS, minStrength: 20, elliottAgreement: 10, wave5Filter: 1 };
    for (const c of candidateMoves(p)) for (const k of ONLY_UP) expect(c.params[k]).toBeGreaterThanOrEqual(p[k]);
    expect(strictnessErrors(p, { ...p, minStrength: 15 })).toHaveLength(1);
    expect(strictnessErrors(p, { ...p, minStrength: 25 })).toHaveLength(0);
  });
  it("Lernschritte ändern nie gesperrte Werte", () => {
    const before = JSON.stringify(LOCKED);
    for (const c of candidateMoves({ ...DEFAULT_PARAMS, minStrength: 10 })) expect(validateParams(c.params)).toEqual([]);
    expect(JSON.stringify(LOCKED)).toBe(before);
  });
});

describe("Gewichtungsgrenzen", () => {
  it("Elliott mindestens 60 %, die anderen mindestens 10 %, Summe 100 %", () => {
    expect(validateWeights({ elliott: 60, fundamental: 20, volume: 20 })).toEqual([]);
    expect(validateWeights({ elliott: 55, fundamental: 25, volume: 20 }).join()).toMatch(/mindestens 60/);
    expect(validateWeights({ elliott: 85, fundamental: 5, volume: 10 }).join()).toMatch(/mindestens 10/);
    expect(validateWeights({ elliott: 70, fundamental: 20, volume: 20 }).join()).toMatch(/100/);
    expect(validateParams({ weights: { elliott: 50, fundamental: 25, volume: 25 } })).not.toEqual([]);
  });
  it("Regler bleiben in den Grenzen, egal wie sie bewegt werden", () => {
    for (const k of ["elliott", "fundamental", "volume"] as const)
      for (let v = 0; v <= 100; v += 7) {
        const w = clampWeights({ elliott: 60, fundamental: 20, volume: 20, [k]: v }, k);
        expect(validateWeights(w)).toEqual([]);
      }
  });
  it("Lernschritte der Gewichtung halten die Grenzen ein", () => {
    const moves = candidateMoves({ ...DEFAULT_PARAMS, minStrength: 10 }).filter((c) => c.change.startsWith("Gewichtung"));
    expect(moves.length).toBeGreaterThan(0);
    for (const c of moves) expect(validateWeights(c.params.weights)).toEqual([]);
    // 60 ist die Untergrenze: Elliott darf nie darunter
    expect(moves.every((c) => c.params.weights.elliott >= 60)).toBe(true);
  });
});

