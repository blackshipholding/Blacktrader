import { describe, expect, it } from "vitest";
import { cleanParams, isBuyGrade, isDowMember, makeVariants, OPPONENTS } from "../src/lib/trainer/opponents";
import { cagr, makeWindows, rank, regimeIndex, reportLines, RULES, runWindow, summarizeRuns, type PoolTrade, type Series, type Window } from "../src/lib/trainer/tournament";
import type { Candle } from "../src/lib/types";

// Kursverlauf mit Auf und Ab (deterministisch)
function series(n: number, seed = 1, drift = 0.0004, wave = 0.01): Candle[] {
  let p = 100;
  let s = seed;
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    s = (s * 16807) % 2147483647;
    const r = (s / 2147483647 - 0.5) * 0.04 + drift + wave * Math.sin(i / 40);
    const o = p;
    p = Math.max(1, p * (1 + r));
    out.push({ time: 1_400_000_000 + i * 86400, open: o, high: Math.max(o, p) * 1.005, low: Math.min(o, p) * 0.995, close: p, volume: 1000 });
  }
  return out;
}

const DAY = 86400;
const W = (from: number, years = 5): Window => ({ from, to: from + years * 365.25 * DAY, scenario: "gemischt" });
const T = (sym: string, d0: number, d1: number, r: number): PoolTrade => ({ sym, entry: 1_500_000_000 + d0 * DAY, exit: 1_500_000_000 + d1 * DAY, r, px: 100 });
const flat = () => 100;

describe("Turnier: Regeln", () => {
  it("8.000 € Start (wie das Depot), 5 Jahre, 50 Versuche, 15 Gegner (16 Teilnehmer), KESt 27,5 %", () => {
    expect(RULES).toMatchObject({ start: 8000, years: 5, reps: 50, stake: 500, tax: 0.275 });
    expect(OPPONENTS).toHaveLength(15);
    for (const g of ["bot", "bank", "strategie"]) expect(OPPONENTS.filter((o) => o.group === g)).toHaveLength(5);
    expect(OPPONENTS.map((o) => o.id)).not.toContain("rsi");
    expect(new Set(OPPONENTS.map((o) => o.id)).size).toBe(15);
  });
  it("ohne Trades bleibt das Geld liegen", () => {
    const r = runWindow([], W(1_500_000_000), flat);
    expect(r.end).toBe(8000);
    expect(r.trades).toBe(0);
  });
  it("KESt sofort bei jedem Gewinn: 100 € → 110 € ergibt 2,75 € KESt", () => {
    // 500 € Einsatz, +10 %: 50 € Kursgewinn → KESt 13,75 € (Spesen sind in Österreich nicht abzugsfähig)
    const r = runWindow([T("A", 10, 40, 10)], W(1_500_000_000), flat);
    expect(r.tax).toBeCloseTo(50 * 0.275, 6);
    expect(10 * 0.275).toBeCloseTo(2.75, 6);
  });
  it("Gewinn wird nach 7,90 € Gebühr je Order und 27,5 % KESt gerechnet", () => {
    // ein Trade +10 % auf 500 €: 50 € Gewinn, 2 × 7,90 € Gebühr, 13,75 € KESt
    const r = runWindow([T("A", 10, 40, 10)], W(1_500_000_000), flat);
    expect(r.trades).toBe(1);
    expect(r.fees).toBeCloseTo(15.8, 6);
    expect(r.tax).toBeCloseTo(50 * 0.275, 6);
    expect(r.profit).toBeCloseTo(50 - 15.8 - 50 * 0.275, 6);
  });
  it("Verlust im selben Jahr holt bezahlte KESt zurück (Verlustausgleich), nicht über das Jahr hinaus", () => {
    const start = Date.UTC(2018, 0, 2) / 1000;
    const at = (d: number) => start + d * DAY;
    const t = (sym: string, d0: number, d1: number, r: number): PoolTrade => ({ sym, entry: at(d0), exit: at(d1), r, px: 100 });
    // Gewinn im Februar, Verlust im März desselben Jahres → KESt zurück
    expect(runWindow([t("A", 10, 40, 10), t("B", 50, 80, -10)], W(start), flat).tax).toBeCloseTo(0, 6);
    // Gewinn 2018, Verlust 2019 → keine Rückzahlung
    expect(runWindow([t("A", 10, 40, 10), t("B", 400, 430, -10)], W(start), flat).tax).toBeCloseTo(50 * 0.275, 6);
  });
  it("nur 500 € je Trade (+ 7,90 € Gebühr) und nur mit genug Geld: höchstens 15 Trades gleichzeitig", () => {
    const many = Array.from({ length: 20 }, (_, i) => T(`S${i}`, 10, 100, 1));
    expect(runWindow(many, W(1_500_000_000), flat).trades).toBe(15);
  });
  it("wer kein Geld mehr hat, scheidet aus", () => {
    const crash = Array.from({ length: 30 }, (_, i) => T(`S${i % 10}`, 10 + i * 40, 30 + i * 40, -95));
    expect(runWindow(crash, W(1_500_000_000), flat).broke).toBe(true);
  });
  it("offene Positionen werden am Ende zum Tageskurs bewertet", () => {
    const r = runWindow([T("A", 10, 5000, 50)], W(1_500_000_000), () => 120);
    expect(r.end).toBeCloseTo(8000 + 100 - 15.8 - 100 * 0.275, 6);
  });
  it("50 Zeiträume à 5 Jahre mit Marktlage", () => {
    const spx = series(15 * 252, 3, 0.0004);
    const ws = makeWindows(spx, spx[200].time);
    expect(ws).toHaveLength(50);
    expect(ws.every((w) => w.to - w.from > 4.9 * 365 * DAY)).toBe(true);
    expect(ws.every((w) => ["bullisch", "neutral", "baerisch", "gemischt"].includes(w.scenario))).toBe(true);
  });
  it("Rangliste nach Ø Rendite pro Jahr; Auswertung nennt Trades und Gewinn nach KESt", () => {
    const w = W(1_500_000_000);
    const good = summarizeRuns("blacktrader", "Blacktrader", "", [{ w, r: runWindow([T("A", 10, 40, 20)], w, flat) }]);
    const bad = summarizeRuns("x", "Schlecht", "", [{ w, r: runWindow([T("A", 10, 40, -20)], w, flat) }]);
    const list = rank([bad, good]);
    expect(list[0].name).toBe("Blacktrader");
    expect(cagr(8000)).toBe(0);
    const lines = reportLines({ v: 2, at: "x", rules: { ...RULES }, ranking: list, scenarioCount: {} });
    expect(lines[0]).toContain("Platz 1 von 2");
    expect(lines[0]).toContain("Trades in 5 Jahren");
    expect(lines[0]).toContain("nach KESt");
  });
  it("Marktlage: steigender Index = bullisch, fallender = bärisch", () => {
    const up = series(400, 1, 0.003, 0);
    const down = series(400, 2, -0.003, 0);
    expect(regimeIndex(up)(up[399].time)).toBe("bullisch");
    expect(regimeIndex(down)(down[399].time)).toBe("baerisch");
    expect(regimeIndex(up)(up[50].time)).toBeNull();
  });
});

describe("Turnier: kein Teilnehmer schaut in die Zukunft", () => {
  // Aktien mit Dow-Namen, Dividenden und Bank-Einstufungen (alle Gegner sollen handeln können)
  const FIRMS = ["Goldman Sachs", "Morgan Stanley", "JP Morgan", "B of A Securities", "Citigroup", "Barclays"];
  const GRADES = ["Buy", "Neutral", "Overweight", "Underweight", "Outperform", "Hold"];
  const ACTIONS = ["up", "down", "init", "main", "reit"];
  const data: Series[] = ["KO", "JNJ", "PG", "MRK", "MSFT", "CVX", "HD", "WMT", "X"].map((symbol, n) => {
    const candles = series(1500, 5 + n * 4, n % 3 === 0 ? -0.0002 : 0.0004);
    const dividends = candles.filter((_, i) => i % 91 === 30).map((c) => ({ time: c.time, amount: 0.5 + (n % 4) * 0.3 }));
    let s = 11 + n;
    const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const analysts = candles.filter((_, i) => i % 9 === n % 9).map((c) => ({ time: c.time + 3600, firm: FIRMS[Math.floor(r() * FIRMS.length)], toGrade: GRADES[Math.floor(r() * GRADES.length)], fromGrade: "", action: ACTIONS[Math.floor(r() * ACTIONS.length)] }));
    return { symbol, candles, kind: "stock" as const, dividends, analysts };
  });
  for (const o of OPPONENTS.filter((x) => x.id !== "zufall" && x.id !== "ki")) {
    it(`${o.name}: Trades bis zu einem Tag ändern sich nicht, wenn spätere Kurse fehlen`, () => {
      const cut = 1100;
      const p = cleanParams(o, null);
      const full = o.build(data, p);
      const part = o.build(data.map((d) => ({ ...d, candles: d.candles.slice(0, cut) })), p);
      const limit = data[0].candles[cut - 1].time;
      const done = (l: PoolTrade[]) => l.filter((t) => t.exit < limit).map((t) => `${t.sym}:${t.entry}:${t.exit}:${t.r.toFixed(6)}`).sort();
      expect(done(part)).toEqual(done(full));
      expect(full.length).toBeGreaterThan(0);
    });
  }
  it("Bank-Analysten kaufen erst am Handelstag NACH der Einstufung", () => {
    for (const id of ["gs", "ms", "jpm", "bofa", "konsens"]) {
      const o = OPPONENTS.find((x) => x.id === id)!;
      for (const t of o.build(data, cleanParams(o, null))) {
        const d = data.find((x) => x.symbol === t.sym)!;
        const ev = d.analysts!.filter((a) => a.time < t.entry);
        expect(ev.length).toBeGreaterThan(0);
        expect(Math.floor(t.entry / 86400)).toBeGreaterThan(Math.floor(ev[ev.length - 1].time / 86400) - 1);
      }
    }
  });
  it("Kaufempfehlung erkennen", () => {
    for (const g of ["Buy", "Strong Buy", "Outperform", "Overweight", "Sector Outperform"]) expect(isBuyGrade(g)).toBe(true);
    for (const g of ["Neutral", "Hold", "Underweight", "Underperform", "Sell", "Equal-Weight", "Market Perform"]) expect(isBuyGrade(g)).toBe(false);
  });
  it("Dow-Mitglieder mit Aufnahme-Datum (Apple erst ab März 2015, Exxon bis August 2020)", () => {
    expect(isDowMember("AAPL", Date.UTC(2014, 0, 1) / 1000)).toBe(false);
    expect(isDowMember("AAPL", Date.UTC(2016, 0, 1) / 1000)).toBe(true);
    expect(isDowMember("XOM", Date.UTC(2021, 0, 1) / 1000)).toBe(false);
    expect(isDowMember("SAP.DE", Date.UTC(2021, 0, 1) / 1000)).toBe(false);
  });
});

describe("Veränderliche Gegner", () => {
  it("Varianten bleiben in den fairen Bereichen; der Champion steht vorne", () => {
    for (const o of OPPONENTS) {
      const champ = cleanParams(o, { ...o.defaults, [o.space[0].key]: o.space[0].max });
      const v = makeVariants(o, champ, 42);
      expect(v[0]).toEqual({ params: champ, origin: "champion" });
      expect(v.length).toBeGreaterThan(1);
      expect(new Set(v.map((x) => JSON.stringify(x.params))).size).toBe(v.length);
      for (const { params } of v) for (const d of o.space) {
        expect(params[d.key]).toBeGreaterThanOrEqual(d.min);
        expect(params[d.key]).toBeLessThanOrEqual(d.max);
      }
    }
  });
  it("ohne Champion: Startwerte aus der veröffentlichten Methode; kaputte Werte werden begrenzt", () => {
    const o = OPPONENTS.find((x) => x.id === "ausbruch")!;
    expect(makeVariants(o, null, 1)[0]).toEqual({ params: { entry: 55, exit: 20 }, origin: "start" });
    expect(cleanParams(o, { entry: 999, exit: Number.NaN })).toEqual({ entry: 60, exit: 20 });
  });
  it("jedes Turnier andere neue Varianten (andere Zufallszahl)", () => {
    const o = OPPONENTS.find((x) => x.id === "high52")!;
    expect(JSON.stringify(makeVariants(o, null, 1))).not.toBe(JSON.stringify(makeVariants(o, null, 2)));
  });
});

describe("Vergleich: echter ETF", () => {
  it("kauft am Anfang alles, verkauft am Ende, zahlt Gebühr und KESt nur auf Gewinn", async () => {
    const { benchmarkRun, RULES } = await import("../src/lib/trainer/tournament");
    const d = 86400;
    const etf = [0, 1, 2, 3].map((i) => ({ time: i * 100 * d, open: 100 + i * 10, high: 100 + i * 10, low: 100 + i * 10, close: 100 + i * 10, volume: 0 }));
    const up = benchmarkRun(etf, { from: 0, to: 300 * d, scenario: "bullisch" });
    const inv = RULES.start - RULES.fee;
    expect(up.end).toBeCloseTo(inv + inv * 0.3 * (1 - RULES.tax) - RULES.fee, 6);
    expect(up.broke).toBe(false);
    const down = benchmarkRun([...etf].reverse().map((c, i) => ({ ...c, time: i * 100 * d })), { from: 0, to: 300 * d, scenario: "baerisch" });
    expect(down.tax).toBe(0);
    expect(down.end).toBeCloseTo((RULES.start - RULES.fee) * (100 / 130) - RULES.fee, 6);
  });
});

describe("Blau-Regel (wieder entfernbar)", () => {
  it("gilt für Chancen und Turnier gleich: Ungültig höchstens 40 %, Chance mindestens 40 %", async () => {
    const { passesBlueRule, BLUE_RULE } = await import("../src/lib/analysis/potential");
    expect(BLUE_RULE.enabled).toBe(true);
    expect(passesBlueRule(60, 20)).toBe(true);
    expect(passesBlueRule(30, 20)).toBe(false);
    expect(passesBlueRule(60, 50)).toBe(false);
    expect(passesBlueRule(undefined, 20)).toBe(false);
  });
  it("ausgeschlossene blaue Trades werden nicht gehandelt; die Auswertung meldet, wenn es ohne Regel besser wäre", async () => {
    const { activePool } = await import("../src/lib/trainer/tournamentRun");
    const pool: PoolTrade[] = [T("A", 10, 40, 10), { ...T("B", 10, 40, 30), color: "blau", blueRuleOut: true }];
    expect(activePool(pool).map((t) => t.sym)).toEqual(["A"]);
    const w = W(1_500_000_000);
    const bt = rank([summarizeRuns("blacktrader", "Blacktrader", "", [{ w, r: runWindow(activePool(pool), w, flat) }])]);
    const warn = reportLines({ v: 2, at: "x", rules: { ...RULES }, ranking: bt, scenarioCount: {}, blueRule: { on: 0.05, off: 0.07 } });
    expect(warn.join(" ")).toContain("ohne sie wäre Blacktrader besser");
    const ok = reportLines({ v: 2, at: "x", rules: { ...RULES }, ranking: bt, scenarioCount: {}, blueRule: { on: 0.07, off: 0.068 } });
    expect(ok.join(" ")).toContain("sie bleibt");
  });
});
