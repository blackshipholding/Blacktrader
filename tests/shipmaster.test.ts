import { describe, expect, it } from "vitest";
import { b8Hardtest, b9Rank, hardtestWindows, HT_CAPS, htStats } from "../src/lib/trainer/hardtest";
import { cleanParams } from "../src/lib/trainer/opponents";
import { HARDTEST_OPPONENTS, TV_OPPONENTS } from "../src/lib/trainer/opponentsTv";
import type { PoolTrade, Series } from "../src/lib/trainer/tournament";
import type { Candle } from "../src/lib/types";

const DAY = 86400;
function series(n: number, seed = 1, drift = 0.0004, wave = 0.012): Candle[] {
  let p = 100;
  let s = seed;
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    s = (s * 16807) % 2147483647;
    const r = (s / 2147483647 - 0.5) * 0.04 + drift + wave * Math.sin(i / 35);
    const o = p;
    p = Math.max(1, p * (1 + r));
    out.push({ time: 1_200_000_000 + i * DAY, open: o, high: Math.max(o, p) * 1.006, low: Math.min(o, p) * 0.994, close: p, volume: 1000 });
  }
  return out;
}

describe("Shipmaster 0.1 – Härtetest im Trainer (B8)", () => {
  const spx = series(15 * 365, 3);
  const { learn, locked } = hardtestWindows(spx, spx[200].time);

  it("Kunden: jeder Wochen-Start × 12 Depotgrößen (10.000 € – 1 Mio. €); die letzten 2 Jahre sind gesperrt", () => {
    expect(HT_CAPS).toHaveLength(12);
    expect(HT_CAPS[0]).toBe(10000);
    expect(HT_CAPS[11]).toBe(1000000);
    expect(learn.length + locked.length).toBeGreaterThan(4000);
    const last = spx[spx.length - 1].time;
    expect(learn.every((w) => w.to <= last - 2 * 365.25 * DAY)).toBe(true);
    expect(locked.every((w) => w.to > last - 2 * 365.25 * DAY)).toBe(true);
    expect(new Set(learn.map((w) => w.cap)).size).toBe(12);
  });

  // Zwei Pools auf denselben Werten: der bessere verdient bei jedem Trade mehr
  const pool = (r: number): PoolTrade[] =>
    Array.from({ length: 40 }, (_, k) => k).flatMap((k) =>
      Array.from({ length: 25 }, (_, j) => ({ sym: `S${k}`, entry: spx[260].time + (j * 140 + k * 3) * DAY, exit: spx[260].time + (j * 140 + k * 3 + 100) * DAY, r: r + ((k + j) % 5) - 2, px: 100, color: "gruen" as const })),
    );
  const priceAt = () => 100;
  const few = learn.filter((w) => (w.k ?? 0) % 8 === 0);

  it("klar besserer Stand besteht alle Prüfungen", () => {
    const r = b8Hardtest(pool(3), pool(6), few, priceAt);
    expect(r.veto).toBeNull();
    expect(r.dropoutWins).toBe(5);
    expect(r.cand.avg).toBeGreaterThan(r.base.avg + 0.002);
  });
  it("schlechterer oder nur minimal besserer Stand wird abgelehnt", () => {
    expect(b8Hardtest(pool(6), pool(3), few, priceAt).veto).toContain("Härtetest");
    expect(b8Hardtest(pool(3), pool(3), few, priceAt).veto).toContain("nicht genug besser");
  });
  it("Kosten-Prüfung rechnet mit doppelten Gebühren und schlechteren Kursen", () => {
    const normal = htStats(pool(3), few, priceAt);
    const stress = htStats(pool(3), few, priceAt, { fee: 15.8, slip: 0.005 });
    expect(stress.avg).toBeLessThan(normal.avg);
  });
});

describe("Shipmaster 0.1 – Gegner-Prüfung (B9)", () => {
  it("der neue Stand darf in der Rangliste gegen die Gegner nicht abrutschen", () => {
    const opp = [{ avgPerYear: 0.12 }, { avgPerYear: 0.08 }, { avgPerYear: 0.05 }];
    expect(b9Rank(0.1, 0.11, opp).veto).toBeNull();
    expect(b9Rank(0.1, 0.07, opp)).toMatchObject({ baseRank: 2, candRank: 3 });
    expect(b9Rank(0.1, 0.07, opp).veto).toContain("abgerutscht");
  });
});

describe("Neue Gegner (TradingView-Bots, Stärkste aus dem Härtetest): kein Blick in die Zukunft", () => {
  const data: Series[] = ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF", "GGG", "HHH", "III", "JJJ", "KKK", "LLL"].map((symbol, n) => ({ symbol, kind: "stock" as const, candles: series(1500, 5 + n * 4, n % 3 === 0 ? -0.0002 : 0.0005) }));
  for (const o of [...TV_OPPONENTS, ...HARDTEST_OPPONENTS]) {
    it(`${o.name}: handelt, und spätere Kurse ändern frühere Trades nicht`, () => {
      const cut = 1100;
      const p = cleanParams(o, null);
      const full = o.build(data, p);
      const part = o.build(data.map((d) => ({ ...d, candles: d.candles.slice(0, cut) })), p);
      const limit = data[0].candles[cut - 1].time;
      const done = (l: PoolTrade[]) => l.filter((t) => t.exit < limit).map((t) => `${t.sym}:${t.entry}:${t.exit}:${t.r.toFixed(6)}`).sort();
      expect(full.length).toBeGreaterThan(0);
      expect(done(part)).toEqual(done(full));
      // Einstieg immer nach dem Signal-Tag (Eröffnung des nächsten Handelstags)
      for (const t of full) expect(t.exit).toBeGreaterThan(t.entry);
    });
  }
});
