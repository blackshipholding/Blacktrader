import { describe, expect, it } from "vitest";
import { LOCKED } from "../src/lib/analysis/locked-config";
import { memoryCells, runJob, startFinalJob, startTrainJob, type Universe } from "../src/lib/trainer/job";
import { evaluateSignal, recordFromAnalysis, type SignalRecord } from "../src/lib/trainer/signals";
import { initialState } from "../src/lib/trainer/state";
import type { SeriesSpec } from "../src/lib/trainer/universe";
import type { Candle } from "../src/lib/types";
import { randomWalk } from "./golden/fixtures";

const lockedBefore = JSON.stringify(LOCKED);
const spec = (symbol: string): SeriesSpec => ({ symbol, kind: "stock", horizon: "medium", interval: "1d", days: 1500, step: 3 });
const uni: Universe = () => [spec("A"), spec("B")];
const BASE: Record<string, Candle[]> = { A: randomWalk(11, 1100, 100, 0.02), B: randomWalk(12, 1100, 50, 0.025) };

/** Gleiche Kurse, nur die letzten 12 Monate völlig anders. */
function withOtherHoldout(c: Candle[]): Candle[] {
  const cut = c[c.length - 1].time - 12 * 30.44 * 86400;
  return c.map((x, i) => (x.time >= cut ? { ...x, open: x.open * (1 + (i % 7) * 0.05), high: x.high * 1.4, low: x.low * 0.7, close: x.close * (1 + (i % 5) * 0.06) } : x));
}

async function runToEnd(load: (s: SeriesSpec) => Promise<Candle[]>) {
  const s = initialState(new Date(0));
  const cells = memoryCells();
  await startTrainJob(s, cells, "stock:medium", uni);
  let n = 0;
  while (s.job && n++ < 20) await runJob(s, load, Date.now() + 60_000, { cells, universe: uni, maxJobs: 0 });
  return { s, cells };
}
const strip = (r: { s: ReturnType<typeof initialState>; cells: ReturnType<typeof memoryCells> }) =>
  JSON.stringify({ log: r.s.log.map((l) => ({ ...l, date: 0 })), rec: { ...r.cells.records.get("stock:medium"), updatedAt: 0, log: 0 } });

describe("Trainer-Job", () => {
  it("benutzt die gesperrten letzten 12 Monate nie zum Lernen", async () => {
    const a = await runToEnd(async (x) => BASE[x.symbol]);
    const b = await runToEnd(async (x) => withOtherHoldout(BASE[x.symbol]));
    expect(a.cells.records.get("stock:medium")?.current?.trades).toBeGreaterThan(0); // es wurde wirklich gehandelt
    expect(strip(a)).toBe(strip(b));
  }, 120_000);

  it("setzt die Arbeit nach Zeitablauf fort und kommt zum selben Ergebnis", async () => {
    const full = await runToEnd(async (x) => BASE[x.symbol]);
    const s = initialState(new Date(0));
    const cells = memoryCells();
    await startTrainJob(s, cells, "stock:medium", uni);
    let t = 0;
    const now = () => (t += 1); // jede Prüfung „kostet“ eine Zeiteinheit → viele kurze Läufe
    let runs = 0;
    while (s.job && runs++ < 500) await runJob(s, async (x) => BASE[x.symbol], t + 4, { cells, now, universe: uni, maxJobs: 0 });
    expect(runs).toBeGreaterThan(2);
    expect(cells.records.get("stock:medium")?.current).toEqual(full.cells.records.get("stock:medium")?.current);
  }, 120_000);

  it("verändert die gesperrten Werte nie", async () => {
    await runToEnd(async (x) => BASE[x.symbol]);
    expect(JSON.stringify(LOCKED)).toBe(lockedBefore);
  }, 120_000);

  it("Abschlusstest: läuft einmal durch", async () => {
    const s = initialState(new Date(0));
    startFinalJob(s, 7, (c) => (c === "stock:medium" ? uni(c) : []));
    while (s.job) await runJob(s, async (x) => BASE[x.symbol], Date.now() + 60_000, { cells: memoryCells(), universe: uni, maxJobs: 0 });
    expect(s.finalTests).toHaveLength(1);
    expect(s.finalTests[0].version).toBe(7);
  }, 120_000);
});

describe("Signal-Protokoll", () => {
  const rec = (over: Partial<SignalRecord> = {}): SignalRecord => ({
    id: "x", createdAt: "", time: 1000, symbol: "X", kind: "stock", horizon: "medium", interval: "1d", version: 1,
    direction: "long", orderType: "limit", entry: 95, stop: 90, targets: [105], cancelAbove: 110, atr: 1, riskReward: 2, strength: 60,
    inputs: { total: 60, elliott: 60, fundamental: 50, volume: 50 }, params: {}, status: "wartet", ...over,
  });
  const c = (time: number, o: number, h: number, l: number, cl: number): Candle => ({ time, open: o, high: h, low: l, close: cl, volume: 1 });

  it("Kerzen vor dem Signal werden ignoriert (kein Blick zurück in bekannte Kurse als Ergebnis)", () => {
    const candles = [c(0, 100, 120, 80, 100), c(1000, 100, 101, 99, 100), c(2000, 100, 100, 94, 96), c(3000, 96, 106, 96, 105)];
    const r = evaluateSignal(rec(), candles);
    expect(r.status).toBe("offen"); // Ziel 1 erreicht → Stop nachgezogen, Trade läuft noch
    const lost = evaluateSignal(rec(), [c(1000, 100, 101, 99, 100), c(2000, 100, 100, 94, 96), c(3000, 96, 96, 89, 89)]);
    expect(lost.status).toBe("verloren");
    expect(lost.returnPct).toBeLessThan(0);
  });

  it("Order ohne Einstieg verfällt, wenn der Kurs davonläuft", () => {
    const r = evaluateSignal(rec(), [c(1000, 100, 101, 99, 100), c(2000, 100, 112, 99, 111)]);
    expect(r.status).toBe("verfallen");
  });

  it("neutrales Ergebnis erzeugt kein Signal", () => {
    expect(recordFromAnalysis({ plan: null, decision: { level: "neutral" } } as never, { symbol: "X", kind: "stock" }, 1, {})).toBeNull();
  });
});

describe("Ohne Kursdaten", () => {
  it("überschreibt nichts und schreibt kein 0-%-Ergebnis", async () => {
    const s = initialState();
    const cells = memoryCells();
    await startTrainJob(s, cells, "stock:medium", uni);
    while (s.job) await runJob(s, async () => { throw new Error("offline"); }, Date.now() + 10_000, { cells, universe: uni, maxJobs: 0 });
    expect(cells.records.size).toBe(0);
    expect(s.history).toHaveLength(0);
    expect(s.log).toHaveLength(1);
  });
});
