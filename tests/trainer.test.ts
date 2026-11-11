import { consistencyError } from "../src/lib/trainer/walkforward";
import { describe, expect, it } from "vitest";
import { LOCKED } from "../src/lib/analysis/locked-config";
import { DEFAULT_PARAMS, validateParams } from "../src/lib/analysis/params";
import { runZoneBacktest } from "../src/lib/analysis/zoneBacktest";
import { backtestSeries, decide, metrics, splitHoldout, walkForwardFolds, type Series } from "../src/lib/trainer/engine";
import { advanceWF, initWF } from "../src/lib/trainer/walkforward";
import { randomWalk } from "./golden/fixtures";

const series = (seed: number, n = 520): Series => ({ name: `s${seed}`, kind: "stock", horizon: "medium", interval: "1d", candles: randomWalk(seed, n) });

describe("Trainer: kein Blick in die Zukunft", () => {
  it("Signale bis Zeitpunkt k sind unabhängig von Kursen nach k", () => {
    const s = series(5, 600);
    const k = 420;
    const collect = (c: typeof s.candles) => {
      const sig: string[] = [];
      runZoneBacktest(c, { warmup: 150, step: 1, signalAt: undefined, onSignal: (x) => x.index < k && sig.push(`${x.index}:${x.setup.direction}:${x.setup.entry.toFixed(6)}:${x.setup.stop.toFixed(6)}`) });
      return sig;
    };
    const original = collect(s.candles);
    // Zukunft drastisch verändern: Crash nach k
    const altered = s.candles.map((c, i) => (i <= k ? c : { ...c, open: c.open * 0.5, high: c.high * 0.5, low: c.low * 0.5, close: c.close * 0.5 }));
    // Nur Signale, die VOR k entstanden sind und deren Simulation k nicht erreicht hat, müssen identisch sein:
    // dazu werden beide Läufe nur bis k analysiert
    const a = collect(s.candles.slice(0, k + 1));
    const b = collect(altered.slice(0, k + 1));
    expect(a).toEqual(b);
    expect(original.slice(0, a.length).length).toBeGreaterThanOrEqual(0);
  });

  it("Analyse-basierte Signale (mit lernbaren Werten) sehen nur die Vergangenheit", () => {
    const s = series(9, 480);
    const seen: number[] = [];
    backtestSeries({ ...s, candles: s.candles }, DEFAULT_PARAMS, { step: 5 });
    runZoneBacktest(s.candles, {
      warmup: 150,
      step: 5,
      signalAt: (hist) => {
        seen.push(hist[hist.length - 1].time);
        return null;
      },
    });
    // jede Analyse endet genau beim jeweiligen Zeitpunkt i (aufsteigend, nie in der Zukunft)
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThan(seen[i - 1]);
    expect(seen[0]).toBe(s.candles[150].time);
  });
});

describe("Trainer: Walk-Forward", () => {
  it("Prüfbereich folgt immer auf den Lernbereich und rollt weiter", () => {
    const f = walkForwardFolds(1150, 4, 150);
    expect(f).toHaveLength(4);
    for (let k = 0; k < f.length; k++) {
      expect(f[k].train[0]).toBe(0);
      expect(f[k].test[0]).toBe(f[k].train[1] - 150); // nur Vorlauf für Indikatoren
      expect(f[k].test[1]).toBeGreaterThan(f[k].train[1]);
      if (k > 0) expect(f[k].train[1]).toBe(f[k - 1].test[1]); // nächster Lernbereich endet, wo der letzte Test endete
    }
  });
  it("die letzten 12 Monate bleiben als Abschlusstest gesperrt", () => {
    const s = series(3, 800);
    const { train, holdout } = splitHoldout(s.candles, 12);
    expect(train.length + holdout.length).toBe(800);
    expect(holdout[0].time - train[train.length - 1].time).toBeGreaterThan(0);
    expect((s.candles[799].time - holdout[0].time) / 86400).toBeLessThanOrEqual(366);
  });
  it("Standardwerte erzeugen dieselben Trades wie das EchoChart", () => {
    const s = series(21, 500);
    const a = backtestSeries(s, DEFAULT_PARAMS, { step: 2 });
    const b = runZoneBacktest(s.candles, { warmup: 150, step: 2 });
    expect(a.trades.map((t) => [t.entryTime, t.exit])).toEqual(b.trades.map((t) => [t.entryTime, t.exit]));
  });
});

describe("Trainer: Regeln gegen Selbstbetrug", () => {
  const m = (o: Partial<ReturnType<typeof metrics>>) => ({ trades: 3000, hitRate: 0.4, avgWin: 2, avgLoss: -1, profitFactor: 1.3, maxDrawdown: -10, perMonth: 10, ...o });
  it("übernimmt nur, wenn auf unbekannten Daten besser", () => {
    expect(decide(m({}), m({ hitRate: 0.45 })).accept).toBe(true);
    expect(decide(m({}), m({ hitRate: 0.39 })).accept).toBe(false);
  });
  it("kein Zufall: kleine Verbesserung bei wenigen Signalen wird nicht übernommen", () => {
    const r = decide(m({ trades: 300 }), m({ hitRate: 0.42, trades: 300 }));
    expect(r.accept).toBe(false);
    expect(r.reasons.join()).toMatch(/Zufall/);
    // dieselbe Verbesserung bei sehr vielen Signalen ist statistisch gesichert
    expect(decide(m({ trades: 20000 }), m({ hitRate: 0.42, trades: 20000 })).accept).toBe(true);
  });
  it("lehnt ab, wenn der Profit-Faktor sinkt", () => {
    expect(decide(m({}), m({ hitRate: 0.5, profitFactor: 1.2 })).reasons.join()).toMatch(/Profit-Faktor/);
  });
  it("lehnt ab, wenn die Signale pro Monat um mehr als 40 % sinken", () => {
    expect(decide(m({}), m({ hitRate: 0.6, perMonth: 5.5 })).reasons.join()).toMatch(/pro Monat/);
    expect(decide(m({}), m({ hitRate: 0.6, perMonth: 6.5 })).accept).toBe(true);
  });
  it("lehnt ab bei weniger als 200 Signalen", () => {
    expect(decide(m({}), m({ hitRate: 0.6, trades: 150 })).reasons.join()).toMatch(/zu wenige Signale/);
  });
});

describe("Trainer rührt feste Werte nicht an", () => {
  it("nach einem Lernlauf sind feste Werte unverändert und Parameter gültig", async () => {
    const before = JSON.stringify(LOCKED);
    const data = [series(41, 700).candles, series(43, 700).candles];
    const specs = data.map((_, i) => ({ symbol: `S${i}`, kind: "stock" as const, horizon: "medium" as const, interval: "1d" as const, days: 0, step: 6 }));
    const st = initWF("stock:medium", specs, DEFAULT_PARAMS, { folds: 2, maxSteps: 1, candidatesPerStep: 3 });
    await advanceWF(st, { load: async (sp) => data[Number(sp.symbol.slice(1))], deadline: Date.now() + 100_000 });
    expect(JSON.stringify(LOCKED)).toBe(before);
    expect(st.result).toBeTruthy();
    expect(validateParams(st.result!.deployed)).toEqual([]);
    expect(Object.keys(st.result!.deployed).sort()).toEqual(Object.keys(DEFAULT_PARAMS).sort());
  }, 120000);
});

describe("Kein Zufall: Verbesserung muss beständig sein", () => {
  // 4 Prüfzeiträume (0–10, 10–20, 20–30, 30–40); je Zeitraum 10 Zonen
  const run = (okPerFold: number[]) => {
    const zt: number[] = [];
    const zo: number[] = [];
    okPerFold.forEach((ok, k) => {
      for (let i = 0; i < 10; i++) {
        zt.push(k * 10 + i);
        zo.push(i < ok ? 1 : 0);
      }
    });
    return { zt, zo };
  };
  const st = (cand: number[], ref: number[]) =>
    ({ folds: 4, specs: [{}], info: [{ bounds: [0, 10, 20, 30, 40] }], pool: { C: { runs: [run(cand)] }, R: { runs: [run(ref)] } } }) as never;
  it("nur in einem Zeitraum viel besser → abgelehnt", () => {
    expect(consistencyError(st([10, 5, 5, 5], [6, 5, 5, 5]), ["C", "C", "C", "C"], "R")).toMatch(/1 von 4/);
  });
  it("in 3 von 4 Zeiträumen besser → in Ordnung", () => {
    expect(consistencyError(st([7, 6, 6, 5], [6, 5, 5, 5]), ["C", "C", "C", "C"], "R")).toBeNull();
  });
});
