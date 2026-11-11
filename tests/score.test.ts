import { describe, expect, it } from "vitest";
import { analyze } from "../src/lib/analysis/analyze";
import { runBacktest } from "../src/lib/analysis/backtest";
import { analyzeFundamentals } from "../src/lib/analysis/fundamental";
import { buildPlan, decideSignal, DEFAULT_WEIGHTS, levelFromScore, normalizeWeights, totalScore } from "../src/lib/analysis/score";
import { scoreHeadline } from "../src/lib/analysis/sentiment";
import { performance, tradeReturnPct } from "../src/lib/analysis/stats";
import { rsiContribution } from "../src/lib/analysis/volume";
import type { WaveCount } from "../src/lib/analysis/elliott";
import { candlesFromWaypoints } from "./helpers";

describe("Gesamtscore", () => {
  it("Standardgewichtung 60/20/20", () => {
    expect(DEFAULT_WEIGHTS).toEqual({ elliott: 60, fundamental: 20, volume: 20 });
    expect(totalScore({ elliott: 80, fundamental: 50, volume: 30 })).toBe(64);
    expect(totalScore({ elliott: 100, fundamental: 100, volume: 100 })).toBe(100);
  });
  it("normalisiert beliebige Gewichte", () => {
    const w = normalizeWeights({ elliott: 3, fundamental: 1, volume: 1 });
    expect(w.elliott).toBeCloseTo(0.6);
    expect(totalScore({ elliott: 70, fundamental: 40, volume: 40 }, { elliott: 0, fundamental: 1, volume: 1 })).toBe(40);
  });
  it("Signalstufen", () => {
    expect(levelFromScore(80)).toBe("strong-buy");
    expect(levelFromScore(60)).toBe("buy");
    expect(levelFromScore(50)).toBe("neutral");
    expect(levelFromScore(40)).toBe("sell");
    expect(levelFromScore(20)).toBe("strong-sell");
  });
});

const count = (over: Partial<WaveCount>): WaveCount =>
  ({ bias: 1, stop: 90, targets: [130, 115, 85], ...over }) as WaveCount;

describe("Trade-Plan und Veto-Logik", () => {
  it("berechnet CRV mit dem nächsten Ziel jenseits des Einstiegs", () => {
    const plan = buildPlan(count({}), 100)!;
    expect(plan.direction).toBe("long");
    expect(plan.targets).toEqual([115, 130]);
    expect(plan.riskReward).toBe(1.5);
  });
  it("Short-Plan", () => {
    const plan = buildPlan(count({ bias: -1, stop: 110, targets: [80, 95] }), 100)!;
    expect(plan.direction).toBe("short");
    expect(plan.targets).toEqual([95, 80]);
    expect(plan.riskReward).toBe(0.5);
  });
  it("kein Plan, wenn Stop auf der falschen Seite", () => {
    expect(buildPlan(count({ stop: 105 }), 100)).toBeNull();
  });
  it("lieber kein Trade als ein schwaches Signal", () => {
    const plan = buildPlan(count({ targets: [104] }), 100)!; // CRV 0.4
    const d = decideSignal(75, { elliottConfidence: 0.9, contested: false, plan });
    expect(d.rawLevel).toBe("strong-buy");
    expect(d.level).toBe("neutral");
    expect(d.vetoes.join()).toMatch(/Chance-Risiko/);
    expect(decideSignal(75, { elliottConfidence: 0.1, contested: false, plan: buildPlan(count({}), 100) }).level).toBe("neutral");
    expect(decideSignal(75, { elliottConfidence: 0.9, contested: false, plan: buildPlan(count({}), 100) }).level).toBe("strong-buy");
    expect(decideSignal(25, { elliottConfidence: 0.9, contested: false, plan: buildPlan(count({}), 100) }).level).toBe("neutral");
  });
});

describe("Volumen/RSI und Fundamentaldaten", () => {
  it("RSI-Beitrag ist stetig an den Zonengrenzen", () => {
    expect(rsiContribution(70)).toBeCloseTo(0.4);
    expect(rsiContribution(70.01)).toBeCloseTo(0.4, 2);
    expect(rsiContribution(30)).toBeCloseTo(-0.4);
    expect(rsiContribution(15)).toBeCloseTo(0.6);
    expect(rsiContribution(85)).toBeCloseTo(-0.6);
  });
  it("Sentiment von Schlagzeilen", () => {
    expect(scoreHeadline("Apple beats estimates, shares surge to record").sentiment).toBe("positive");
    expect(scoreHeadline("Siemens: Gewinnwarnung – Aktie fällt deutlich").sentiment).toBe("negative");
    expect(scoreHeadline("Company schedules annual meeting").sentiment).toBe("neutral");
  });
  it("Fundamental-Score kombiniert Kennzahlen und News", () => {
    const now = Date.parse("2026-01-10T12:00:00Z");
    const good = analyzeFundamentals(
      { kind: "stock", pe: 11, epsGrowth: 0.2, revenueGrowth: 0.15, profitMargin: 0.2, debtToEquity: 30, source: "t" },
      [{ title: "x", link: "", source: "s", published: "2026-01-10T10:00:00Z", sentiment: "positive", sentimentScore: 1 }],
      now,
    );
    const bad = analyzeFundamentals({ kind: "stock", pe: -5, epsGrowth: -0.3, revenueGrowth: -0.1, profitMargin: -0.1, debtToEquity: 300, source: "t" }, [], now);
    expect(good.score).toBeGreaterThan(70);
    expect(bad.score).toBeLessThan(35);
    expect(analyzeFundamentals(null, [], now).score).toBe(50);
  });
});

describe("Performance-Kennzahlen", () => {
  it("Rendite, Trefferquote, Drawdown", () => {
    expect(tradeReturnPct("long", 100, 110)).toBeCloseTo(10);
    expect(tradeReturnPct("short", 100, 110)).toBeCloseTo(-10);
    const s = performance([
      { returnPct: 10, closedAt: 1 },
      { returnPct: -20, closedAt: 2 },
      { returnPct: 5, closedAt: 3 },
    ]);
    expect(s.trades).toBe(3);
    expect(s.winRate).toBeCloseTo(2 / 3);
    expect(s.avgWin).toBeCloseTo(7.5);
    expect(s.avgLoss).toBeCloseTo(-20);
    expect(s.totalReturn).toBeCloseTo((1.1 * 0.8 * 1.05 - 1) * 100);
    expect(s.maxDrawdown).toBeCloseTo(-20);
  });
});

describe("Gesamtanalyse und Backtest", () => {
  const candles = candlesFromWaypoints([150, 130, 138, 100, 124, 109.2, 140, 128, 160, 120, 135, 105, 150], 15, 0.004, 3);
  it("liefert konsistentes Ergebnis mit Begründung", () => {
    const res = analyze({ symbol: "TEST", name: "Test", candles, horizon: "medium", interval: "1d" })!;
    expect(res.total).toBeGreaterThanOrEqual(0);
    expect(res.total).toBeLessThanOrEqual(100);
    expect(res.commentary.headline.length).toBeGreaterThan(10);
    expect(res.commentary.invalidation).toBeTruthy();
    if (res.decision.level !== "neutral") expect(res.plan!.riskReward).toBeGreaterThanOrEqual(1.5);
  });
  it("Backtest ohne Blick in die Zukunft", () => {
    const bt = runBacktest(candles, { horizon: "medium", interval: "1d", warmup: 60, step: 3 });
    expect(bt.evaluatedBars).toBeGreaterThan(0);
    for (const t of bt.trades) {
      expect(t.exitTime).toBeGreaterThan(t.entryTime);
      if (t.reason === "stop") expect(t.returnPct).toBeLessThanOrEqual(0.0001);
    }
    expect(bt.stats.trades).toBe(bt.trades.length);
  });
});

describe("Kurzbegründung in Alltagssprache", () => {
  it("nennt Einstieg und Stop mit Währung und einen einfachen Grund", async () => {
    const { money, plainReason } = await import("../src/lib/analysis/persona");
    expect(money(12.5, "EUR")).toBe("12,50 €");
    expect(money(10, "EUR")).toBe("10,00 €");
    const c = { pattern: "zigzag", complete: true, bias: 1, labels: ["A", "B", "C"] } as unknown as WaveCount;
    expect(plainReason(c, "die Aktie")).toMatch(/Boden gebildet/);
    const candles = candlesFromWaypoints([150, 130, 138, 100, 124, 109.2, 112], 15, 0.004, 3);
    const res = analyze({ symbol: "T", name: "T", candles, horizon: "medium", interval: "1d", kind: "stock", currency: "EUR" })!;
    if (res.decision.level !== "neutral") {
      expect(res.commentary.summary).toMatch(/Einstieg bei .+ € · Stop bei .+ €/);
      expect(res.commentary.reason).toMatch(/Einstieg/);
    } else expect(res.commentary.summary).toBe("Kein Einstieg – abwarten");
  });
});

describe("Anfängertexte", () => {
  it("enthalten keine Wellen-Nummern oder Fachbegriffe", async () => {
    const { plainReason, plainSetup } = await import("../src/lib/analysis/persona");
    const patterns = ["impulse", "zigzag", "flat-regular", "triangle-contracting", "ending-diagonal", "leading-diagonal", "double-zigzag"];
    for (const pattern of patterns)
      for (const n of [2, 3, 4, 5])
        for (const bias of [1, -1]) {
          const c = { pattern, complete: n === 5 || pattern !== "impulse", bias, labels: Array.from({ length: n }, (_, i) => String(i + 1)) } as unknown as WaveCount;
          const txt = `${plainReason(c, "sie")} ${plainSetup(c)}`;
          expect(txt).not.toMatch(/\d|Welle|Elliott|Impuls|Zigzag|Fibo|Diagonal/);
        }
  });
});
