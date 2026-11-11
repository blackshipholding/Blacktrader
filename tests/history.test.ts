import { afterEach, describe, expect, it, vi } from "vitest";
import { loadHistory, planHistory } from "../src/lib/client/history";
import { runBacktest, runBacktestAsync } from "../src/lib/analysis/backtest";
import { candlesFromWaypoints } from "./helpers";

const gold = { kind: "commodity" as const, yahooSymbol: "GC=F" };
const silver = { kind: "commodity" as const, yahooSymbol: "SI=F" };
const btc = { kind: "crypto" as const, binanceSymbol: "BTCUSDT", yahooSymbol: "BTC-USD" };

describe("EchoChart: Quellen und Zeiträume", () => {
  it("Gold 5 Minuten über 1 Jahr läuft über PAXG (Binance)", () => {
    const p = planHistory(gold, "5m", 365);
    expect(p.ok).toBe(true);
    expect(p.source).toBe("binance");
    expect(p.symbol).toBe("PAXGUSDT");
    expect(p.candlesEstimate).toBe(105120);
  });
  it("kurze Zeiträume kommen direkt von Yahoo", () => {
    expect(planHistory(gold, "5m", 30)).toMatchObject({ ok: true, source: "yahoo", symbol: "GC=F" });
    expect(planHistory(silver, "1d", 3650)).toMatchObject({ ok: true, source: "yahoo" });
  });
  it("ehrlicher Hinweis, wenn die Quelle den Zeitraum nicht liefert", () => {
    const p = planHistory(silver, "5m", 365);
    expect(p.ok).toBe(false);
    expect(p.reason).toMatch(/60 Tage/);
    expect(planHistory(silver, "1h", 1825).reason).toMatch(/2 Jahre/);
  });
  it("Obergrenze für sehr viele Kerzen", () => {
    expect(planHistory(btc, "5m", 365).ok).toBe(true);
    expect(planHistory(btc, "5m", 730).ok).toBe(false);
  });
});

describe("EchoChart: seitenweises Laden", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("lädt Binance-Seiten lückenlos bis heute", async () => {
    const step = 3600;
    const now = Math.floor(Date.now() / 1000);
    const calls: number[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      const start = Number(new URL(url, "http://x").searchParams.get("start")) / 1000;
      calls.push(start);
      const candles = [];
      for (let t = Math.ceil(start / step) * step; t <= now && candles.length < 1000; t += step) candles.push({ time: t, open: 1, high: 1, low: 1, close: 1, volume: 1 });
      return new Response(JSON.stringify({ candles }), { status: 200 });
    });
    const out = await loadHistory({ ok: true, source: "binance", symbol: "BTCUSDT", candlesEstimate: 0 }, "1h", 100);
    expect(calls.length).toBe(3); // 2400 Stunden = 3 Seiten
    for (let i = 1; i < out.length; i++) expect(out[i].time - out[i - 1].time).toBe(step);
    expect(out.length).toBeGreaterThan(2390);
  });
});

describe("EchoChart: asynchrone Berechnung", () => {
  it("liefert dasselbe Ergebnis wie die direkte Berechnung", async () => {
    const c = candlesFromWaypoints([150, 130, 138, 100, 124, 109.2, 140, 128, 160, 120, 135, 105, 150], 15, 0.004, 3);
    const a = runBacktest(c, { horizon: "medium", interval: "1d" });
    const progress: number[] = [];
    const b = await runBacktestAsync(c, { horizon: "medium", interval: "1d" }, (p) => progress.push(p));
    expect(b.stats.totalReturn).toBeCloseTo(a.stats.totalReturn);
    expect(b.trades.length).toBe(a.trades.length);
    expect(progress[progress.length - 1]).toBe(1);
  });
});
