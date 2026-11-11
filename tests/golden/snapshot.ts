// Erzeugt die Kennzahlen, die vor und nach dem Umbau identisch sein müssen.
import { analyze } from "../../src/lib/analysis/analyze";
import { runBacktest } from "../../src/lib/analysis/backtest";
import { runZoneBacktest } from "../../src/lib/analysis/zoneBacktest";
import type { Fundamentals, NewsItem } from "../../src/lib/types";
import { FIXTURES } from "./fixtures";

const r6 = (x: number | null | undefined) => (x == null ? null : Math.round(x * 1e6) / 1e6);
const FUND: Fundamentals = { kind: "stock", pe: 18, ps: 4, pb: 3, epsGrowth: 0.12, revenueGrowth: 0.08, profitMargin: 0.2, debtToEquity: 80, freeCashflow: 5e9, marketCap: 1e11, dividendYield: 0.02, source: "test" };
const NEWS: NewsItem[] = [
  { title: "Company beats estimates", link: "", source: "t", published: "2026-01-10T10:00:00Z", sentiment: "positive", sentimentScore: 1 },
  { title: "Probe opened", link: "", source: "t", published: "2026-01-09T10:00:00Z", sentiment: "negative", sentimentScore: -0.5 },
];

export function snapshot() {
  const out: Record<string, unknown> = {};
  for (const [name, c] of Object.entries(FIXTURES)) {
    const ends = [200, 350, 500, c.length];
    out[name] = {
      analyses: ends.map((e) => {
        const a = analyze({ symbol: "T", name: "T", candles: c.slice(0, e), horizon: "medium", interval: "1d", fundamentals: FUND, news: NEWS, now: Date.parse("2026-01-10T12:00:00Z") })!;
        const leg = analyze({ symbol: "T", name: "T", candles: c.slice(0, e), horizon: "medium", interval: "1d", mode: "elliott" })!;
        return {
          total: r6(a.total),
          elliott: a.elliott.score,
          fundamental: a.fundamental.score,
          volume: a.volume.score,
          level: a.decision.level,
          plan: a.plan ? { d: a.plan.direction, e: r6(a.plan.entry), s: r6(a.plan.stop), t: a.plan.targets.map(r6), rr: a.plan.riskReward, o: a.plan.orderType } : null,
          best: a.elliott.best ? `${a.elliott.best.pattern}:${a.elliott.best.labels.join("")}:${r6(a.elliott.best.quality)}` : null,
          counts: a.elliott.counts.length,
          legacyLevel: leg.decision.level,
          legacyPlan: leg.plan ? [r6(leg.plan.entry), r6(leg.plan.stop), r6(leg.plan.targets[0])] : null,
        };
      }),
      zone: (() => {
        const z = runZoneBacktest(c, { warmup: 150 });
        return { n: z.trades.length, ret: r6(z.stats.totalReturn), win: r6(z.stats.winRate) };
      })(),
      legacy: (() => {
        const z = runBacktest(c, { horizon: "medium", interval: "1d", warmup: 150 });
        return { n: z.trades.length, ret: r6(z.stats.totalReturn) };
      })(),
    };
  }
  return out;
}
