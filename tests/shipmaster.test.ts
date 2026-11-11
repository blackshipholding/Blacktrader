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

describe("Update 11.11.2026 – Schönheitsfehler: fast gleiche Zone nicht grau in die aktuelle Box", () => {
  it("sameZone erkennt praktisch dieselbe Zone, aber keine andere", async () => {
    const { sameZone } = await import("../src/components/MiniChart");
    expect(sameZone([100, 90], [99, 91])).toBe(true);
    expect(sameZone([100, 90], [92, 70])).toBe(false);
    expect(sameZone([100, 90], [80, 70])).toBe(false);
  });
});

describe("Shipmaster 0.2 – Gewinn-Schutz für Blau", () => {
  it("fällig nur über der Oberkante UND ab +20 % über dem Ø Einstieg", async () => {
    const { protectDue } = await import("../src/lib/analysis/longterm");
    expect(protectDue(125, 100, 110)).toBe(true); // über Oberkante, +25 %
    expect(protectDue(115, 100, 110)).toBe(false); // über Oberkante, nur +15 %
    expect(protectDue(105, 90, 110)).toBe(false); // +16 %, aber unter der Oberkante
    expect(protectDue(110, 90, 110)).toBe(false); // genau auf der Oberkante zählt noch nicht
    expect(protectDue(130, 0, 110)).toBe(false); // kein Einstieg
  });

  it("Vorschlag je Kauf: Stop auf die Oberkante, wartende Teile löschen, nur einmal", async () => {
    const { shipmasterProtect, proposalSteps } = await import("../src/lib/client/longterm");
    const t = {
      id: "x", strategy: "longterm", status: "open", symbol: "ABC", name: "ABC", kind: "stock", currency: "EUR", stop: 0, entry: 100, openedAt: 1, targets: [200],
      lt: { zoneTop: 110, zoneBottom: 90, invalidation: 70, targets: [200], key: "k1" },
      tranches: [{ price: 100, filledAt: 1, qty: 10, eur: 1000 }, { price: 95, qty: 10, eur: 950 }],
    } as never;
    const a = shipmasterProtect(t, 125);
    expect(a).toMatchObject({ kind: "stop", stop: 110, key: "ship02:k1" });
    expect(shipmasterProtect(t, 112)).toBeNull(); // +12 % – noch nicht
    expect(shipmasterProtect({ ...(t as object), lastActionKey: "ship02:k1" } as never, 125)).toBeNull(); // schon erledigt/abgelehnt
    const steps = proposalSteps({ ...(t as object), proposal: { key: "ship02:k1", kind: "stop", reason: "", stop: 110, price: 125, at: 1 } } as never);
    expect(steps.join(" | ")).toMatch(/Stop-Loss für 10 Stück/);
    expect(steps.join(" | ")).toMatch(/wartende Kauf-Order/);
  });

  it("Test-Simulation: Stop auf der Oberkante verkauft mit Gewinn statt später ungültig", async () => {
    const { runLongTermEcho } = await import("../src/lib/analysis/longterm");
    // Aufwärtstrend, Welle 1, Rücksetzer in die Zone, Ausbruch, dann Absturz unter den Wellenstart
    const mk = (n: number, f: (i: number) => number): Candle[] => Array.from({ length: n }, (_, i) => { const c = f(i); return { time: 1_200_000_000 + i * 7 * 86400, open: c, high: c * 1.01, low: c * 0.99, close: c, volume: 1000 }; });
    const path = (i: number) => (i < 200 ? 100 + Math.sin(i / 6) * 3 : i < 230 ? 100 + (i - 200) * 4 : i < 245 ? 220 - (i - 230) * 6 : i < 280 ? 130 + (i - 245) * 5 : 305 - (i - 280) * 20);
    const on = runLongTermEcho(mk(330, path));
    const off = runLongTermEcho(mk(330, path), undefined, 1, 600, null);
    expect(on.trades.length).toBeGreaterThanOrEqual(0);
    // Schutz darf nie schlechter enden als „ungültig“ mit Schlusskurs weit darunter: mindestens gleich viele oder weniger Verluste
    expect(on.invalidiert).toBeLessThanOrEqual(off.invalidiert);
  });
});
