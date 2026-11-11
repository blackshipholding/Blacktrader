import { describe, expect, it } from "vitest";
import { allowedHorizons, closeInHistory, entryStatus, doneKeys, longTermOutcome, marketContext, pickBestEntry, updateHistory, type BestEntry } from "../src/lib/analysis/bestEntry";
import { checkPromotion, trailStop } from "../src/lib/analysis/promotion";
import type { LongTermZone } from "../src/lib/analysis/longterm";
import type { AnalysisResult } from "../src/lib/analysis/analyze";

const res = (dir: "long" | "short" | null, zone: [number, number] = [100, 95], extra: Partial<AnalysisResult> = {}) =>
  ({
    plan: dir ? { direction: dir, entry: zone[0], stop: zone[1] - 5, targets: [zone[0] + 20], riskReward: 2, zoneStart: zone[0], zoneEnd: zone[1], orderType: "limit" } : null,
    decision: { level: dir ? "buy" : "neutral", vetoes: dir ? [] : ["Keine Einstiegszone in Reichweite"], rawLevel: "neutral" },
    commentary: { reason: "Boden ausgebildet", summary: "Einstieg" },
    elliott: { best: { phase: "Korrektur läuft", bias: 1, pivots: [], targets: [], patternLabel: "Impuls", pattern: "impulse", complete: false, direction: 1 }, contested: false, counts: [] },
    ...extra,
  }) as unknown as AnalysisResult;
const lt = (status: LongTermZone["status"] = "zulaufend"): LongTermZone =>
  ({ start: { time: 1, price: 50 }, high: { time: 2, price: 150 }, zoneTop: 88, zoneBottom: 61, invalidation: 50, targets: [150, 200], tranches: [88, 75, 61], status, deepest: 100, context: "neuer Trend", key: "k1" }) as LongTermZone;
const bull = { spBull: true, techWeak: false };

describe("Ein Einstieg pro Wert", () => {
  it("liefert immer genau einen Einstieg (Blau / Grün / Gelb)", () => {
    expect(pickBestEntry({ symbol: "KO", kind: "stock", views: { medium: res("long") }, ctx: bull }).color).toBe("gruen");
    expect(pickBestEntry({ symbol: "KO", kind: "stock", views: {}, lt: lt(), ctx: bull }).color).toBe("blau");
    expect(pickBestEntry({ symbol: "KO", kind: "stock", views: { medium: res(null) }, ctx: bull }).color).toBe("gelb");
  });
  it("Blau im Bereich hat Vorrang, sonst Grün vor zulaufendem Blau", () => {
    expect(pickBestEntry({ symbol: "KO", kind: "stock", views: { medium: res("long") }, lt: lt("in-zone"), ctx: bull }).color).toBe("blau");
    expect(pickBestEntry({ symbol: "KO", kind: "stock", views: { medium: res("long") }, lt: lt("zulaufend"), ctx: bull }).color).toBe("gruen");
  });
  it("Short-Signal ergibt Rot – aber nur bei bärischem Gesamtmarkt", () => {
    const bear = { spBull: false, techWeak: false, spBear: true };
    const e = pickBestEntry({ symbol: "KO", kind: "stock", views: { medium: res("short", [95, 100]) }, ctx: bear });
    expect(e.color).toBe("rot");
    const w = pickBestEntry({ symbol: "KO", kind: "stock", views: { medium: res("short", [95, 100]) }, ctx: bull });
    expect(w.color).toBe("gelb");
    expect(w.waitFor).toMatch(/bärisch/);
    expect(e.dir).toBe("short");
    expect(e.key).toMatch(/^rot:/);
  });
  it("Sektor-Regel sperrt nur grüne Tech-Trades – rote Shorts bleiben", () => {
    const weak = { spBull: false, techWeak: true, spBear: true };
    expect(pickBestEntry({ symbol: "NVDA", kind: "stock", views: { medium: res("long") }, ctx: weak }).color).toBe("gelb");
    expect(pickBestEntry({ symbol: "NVDA", kind: "stock", views: { medium: res("short", [95, 100]) }, ctx: weak }).color).toBe("rot");
  });
  it("Short: hineingestiegen und unten wieder heraus → erledigt; über dem Stop → ungültig", () => {
    const e = { key: "rot:x", color: "rot" as const, dir: "short" as const, zoneTop: 100, zoneBottom: 95, stop: 110, from: 0 };
    const c = (time: number, high: number, close: number) => ({ time, open: close, high, low: close - 1, close, volume: 1 });
    expect(entryStatus(e, [c(1, 90, 89), c(2, 97, 96), c(3, 94, 93)]).status).toBe("erledigt");
    expect(entryStatus(e, [c(1, 97, 96), c(2, 112, 111)]).status).toBe("ungültig");
  });
  it("Aktien und Krypto ohne kurzfristig; Rohstoffe kurzfristig nur im bullischen Markt", () => {
    expect(allowedHorizons("stock", bull)).not.toContain("short");
    expect(allowedHorizons("crypto", bull)).not.toContain("short");
    expect(allowedHorizons("commodity", bull)).toContain("short");
    expect(allowedHorizons("commodity", { spBull: false, techWeak: false })).not.toContain("short");
    expect(pickBestEntry({ symbol: "AAPL", kind: "stock", views: { short: res("long") }, ctx: bull }).color).toBe("gelb");
  });
  it("Sektor-Regel: Tech schwach → keine grünen Tech-Trades, Dividendenwerte weiter", () => {
    const weak = { spBull: false, techWeak: true };
    expect(pickBestEntry({ symbol: "NVDA", kind: "stock", views: { medium: res("long") }, ctx: weak }).color).toBe("gelb");
    expect(pickBestEntry({ symbol: "KO", kind: "stock", views: { medium: res("long") }, ctx: weak }).color).toBe("gruen");
    expect(pickBestEntry({ symbol: "NVDA", kind: "stock", views: {}, lt: lt(), ctx: weak }).color).toBe("blau");
  });
  it("Marktlage aus Tageskerzen", () => {
    const up = Array.from({ length: 260 }, (_, i) => ({ time: i, open: 100 + i, high: 101 + i, low: 99 + i, close: 100 + i, volume: 1 }));
    expect(marketContext(up, up)).toEqual({ spBull: true, techWeak: false, spBear: false });
    const down = up.map((c, i) => ({ ...c, close: 400 - i, open: 400 - i, high: 401 - i, low: 399 - i }));
    expect(marketContext(down, down).spBear).toBe(true);
  });
});

describe("Alte Einstiege werden grau", () => {
  const k = (time: number, low: number, close: number) => ({ time, open: close, high: Math.max(close, low), low, close, volume: 1 });
  const green: BestEntry = { color: "gruen", key: "g1", zoneTop: 100, zoneBottom: 95, stop: 90, targets: [120], invalidation: 90, reason: "" };
  it("abgelöst, wenn ein anderer Einstieg aktuell wird", () => {
    let h = updateHistory({ past: [] }, green, 10);
    h = updateHistory(h, { ...green, key: "g2", zoneTop: 110 }, 20);
    expect(h.current?.key).toBe("g2");
    expect(h.past[0]).toMatchObject({ key: "g1", status: "abgelöst", to: 20 });
  });
  it("erledigt: in die Zone eingetaucht und oben wieder heraus – wird danach nicht mehr gezeigt", () => {
    let h = updateHistory({ past: [] }, green, 10);
    h = updateHistory(h, green, 40, [k(20, 97, 98), k(30, 99, 103)]);
    expect(h.past[0]).toMatchObject({ key: "g1", status: "erledigt" });
    expect(doneKeys(h).has("g1")).toBe(true);
    expect(pickBestEntry({ symbol: "KO", kind: "stock", views: {}, lt: lt(), ctx: bull, done: new Set(["blau:k1"]) }).color).toBe("gelb");
  });
  it("ungültig, wenn der Kurs unter den Stop schließt", () => {
    let h = updateHistory({ past: [] }, green, 10);
    h = updateHistory(h, green, 40, [k(20, 85, 86)]);
    expect(h.past[0].status).toBe("ungültig");
  });
});

describe("Hochstufung Grün → Blau", () => {
  const weekly = res(null, [0, 0], { elliott: { best: { phase: "Welle 3 läuft", pattern: "impulse", complete: false, direction: 1, bias: 1, targets: [180, 220], patternLabel: "Impuls", pivots: [] }, contested: false } as never });
  const daily = res(null, [0, 0], { elliott: { best: { pivots: [{ type: "L", price: 108, confirmed: true }, { type: "H", price: 130, confirmed: true }] }, contested: false } as never });
  it("Wochenchart bestätigt → hochgestuft, Stop auf das letzte Korrekturtief nachgezogen", () => {
    const p = checkPromotion({ direction: "long", entry: 100, stop: 90, targets: [120] }, weekly, daily, 135);
    expect(p).not.toBeNull();
    expect(p!.stop).toBe(108);
    expect(p!.targets).toEqual([180, 220]);
  });
  it("Stop wird nie zurückgesetzt", () => {
    expect(trailStop(110, 108, 135)).toBe(110);
    expect(trailStop(100, 108, 135)).toBe(108);
    expect(trailStop(100, 140, 135)).toBe(100); // nicht über den Kurs
    expect(checkPromotion({ direction: "long", entry: 100, stop: 115, targets: [120] }, weekly, daily, 135)!.stop).toBe(115);
  });
  it("keine Hochstufung ohne Bestätigung oder im Verlust", () => {
    expect(checkPromotion({ direction: "long", entry: 100, stop: 90, targets: [120] }, res(null, [0, 0], { elliott: { best: undefined, contested: false, counts: [] } } as never), daily, 135)).toBeNull();
    expect(checkPromotion({ direction: "long", entry: 100, stop: 90, targets: [120] }, weekly, daily, 95)).toBeNull();
  });
});

describe("Blauer Bereich ab dem Hoch von Welle 1 geprüft", () => {
  const z = { start: { time: 0, price: 50 }, high: { time: 10, price: 150 }, zoneTop: 88, zoneBottom: 61, invalidation: 50, targets: [150, 200], tranches: [88, 75, 61], status: "zulaufend", deepest: 80, context: "neuer Trend", key: "k9" } as LongTermZone;
  const c = (time: number, low: number, close: number) => ({ time, open: close, high: close + 1, low, close, volume: 1 });
  it("eingetaucht und oben wieder heraus → erledigt (grau), auch wenn vorher nie angezeigt", () => {
    const o = longTermOutcome(z, [c(11, 120, 125), c(12, 85, 90), c(13, 88, 95), c(14, 96, 100)]);
    expect(o?.status).toBe("erledigt");
    expect(o?.at).toBe(13);
    const h = closeInHistory({ past: [] }, o!.entry, o!.status, o!.at);
    expect(doneKeys(h).has("blau:k9")).toBe(true);
    // danach wird Blau nicht mehr als aktueller Einstieg gezeigt
    expect(pickBestEntry({ symbol: "X", kind: "stock", views: {}, lt: z, ctx: bull, done: doneKeys(h) }).color).toBe("gelb");
  });
  it("noch nicht eingetaucht → bleibt aktuell", () => {
    expect(longTermOutcome(z, [c(11, 120, 125), c(12, 95, 100)])).toBeNull();
  });
  it("Schlusskurs unter dem Wellenstart → ungültig", () => {
    expect(longTermOutcome(z, [c(11, 70, 75), c(12, 45, 48)])?.status).toBe("ungültig");
  });
});

describe("Chancen: nur Trainings-Werte, nach Potenzial", () => {
  it("Watchlist-Werte außerhalb der Trainings-Werte kommen nicht in die Chancen", async () => {
    const { inUniverse, UNIVERSE_ASSETS } = await import("../src/lib/client/presets");
    expect(UNIVERSE_ASSETS).toHaveLength(65);
    expect(inUniverse({ kind: "stock", symbol: "AAPL" })).toBe(true);
    expect(inUniverse({ kind: "stock", symbol: "CE" })).toBe(false);
    expect(inUniverse({ kind: "stock", symbol: "EURUSD=X" })).toBe(false);
  });
  it("Trainings-Werte der App = Trainings-Werte des Trainers", async () => {
    const { UNIVERSE_GROUPS } = await import("../src/lib/client/presets");
    const { universe } = await import("../src/lib/trainer/universe");
    const yahoo = (a: { yahooSymbol?: string; symbol: string }) => a.yahooSymbol ?? a.symbol;
    for (const g of UNIVERSE_GROUPS) expect(g.assets.map(yahoo).sort()).toEqual(universe(`${g.kind}:medium` as never).map((s) => s.symbol).sort());
  });
});

describe("Chancen: der Markt (rund 190 Werte), ohne reine Watchlist-Werte", () => {
  it("S&P 100, DAX, ATX, 20 Krypto, 10 Rohstoffe – Watchlist-Werte außerhalb nicht", async () => {
    const { MARKET_ASSETS, MARKET_GROUPS, inMarket } = await import("../src/lib/client/marketList");
    expect(MARKET_ASSETS.length).toBeGreaterThan(180);
    expect(MARKET_GROUPS.find((g) => g.kind === "crypto")!.assets).toHaveLength(20);
    expect(inMarket({ kind: "stock", symbol: "EBS.VI" })).toBe(true); // Erste Group (ATX)
    expect(inMarket({ kind: "stock", symbol: "CE" })).toBe(false);
    expect(new Set(MARKET_ASSETS.map((a) => `${a.kind}:${a.symbol}`)).size).toBe(MARKET_ASSETS.length); // keine Doppelten
  });
});

describe("Chancen: nur die mit der höchsten Chance (höchstens 20, gern weniger)", () => {
  const entry = (best: Partial<BestEntry>, price: number) =>
    ({ asset: { kind: "stock", symbol: "AAPL", name: "Apple" }, horizons: { medium: { res: { price }, candles: [] } }, longterm: null, history: { past: [] }, best: { key: "k", reason: "", ...best } }) as never;
  const green = (strength: number, stop: number, price = 100) => entry({ color: "gruen", zoneTop: 100, zoneBottom: 95, stop, targets: [140], res: { total: strength, plan: { direction: "long" }, decision: { level: "buy" } } as never }, price);
  it("starker grüner Trade nah an der Zone mit engem Stop → dabei", async () => {
    const { isTopChance } = await import("../src/lib/client/scanner");
    expect(isTopChance(green(60, 85))).toBe(true);
  });
  it("weit weg von der Zone oder zu wenig Chance → nicht dabei; weiter Stop ist erlaubt (im Turnier besser)", async () => {
    const { isTopChance } = await import("../src/lib/client/scanner");
    expect(isTopChance(green(60, 85, 130))).toBe(false); // Kurs 23 % über der Zone
    const far = (target: number) => entry({ color: "gruen", zoneTop: 100, zoneBottom: 95, stop: 60, targets: [target], res: { total: 60, plan: { direction: "long" }, decision: { level: "buy" } } as never }, 100);
    expect(isTopChance(far(200))).toBe(true); // Stop 40 % entfernt – erlaubt, wenn das Potenzial reicht
    expect(isTopChance(far(140))).toBe(false); // gleicher Stop, aber nur Chance 40 % → untere Hälfte nach Potenzial
    const small = entry({ color: "gruen", zoneTop: 100, zoneBottom: 95, stop: 90, targets: [110], res: { total: 60, plan: { direction: "long" }, decision: { level: "buy" } } as never }, 100);
    expect(isTopChance(small)).toBe(false); // Chance nur 10 %
  });
  it("Blau nur im Bereich und mit begrenzter Ungültig-Grenze", async () => {
    const { isTopChance } = await import("../src/lib/client/scanner");
    const blue = (inv: number, price: number) => entry({ color: "blau", zoneTop: 100, zoneBottom: 80, invalidation: inv, targets: [160] }, price);
    expect(isTopChance(blue(70, 95))).toBe(true); // Blau braucht keine Potenzial-Grenze, nur die Blau-Regel
    expect(isTopChance(blue(20, 95))).toBe(false); // Ungültig 80 % entfernt
    expect(isTopChance(blue(70, 110))).toBe(false); // noch nicht im Bereich
  });
});

describe("Potenzial (gleich in Chancen, Turnier und Training)", () => {
  it("Grundwert: Chance (max. 60) × Chance/Risiko (max. 4) / 2 × Signalart", async () => {
    const { basePotential, MIN_POTENTIAL } = await import("../src/lib/analysis/potential");
    expect(basePotential(40, 10, "gruen")).toBeCloseTo(80, 6);
    expect(basePotential(100, 10, "gruen")).toBeCloseTo(120, 6);
    expect(basePotential(40, 10, "blau")).toBeCloseTo(28, 6);
    expect(basePotential(undefined, 10, "gruen")).toBe(0);
    expect(MIN_POTENTIAL).toBe(26);
  });
});

describe("Haupt- und Alternativszenario", () => {
  it("Anteile ergeben 100 %; fast gleich starke Gegenrichtung = Notfall", async () => {
    const { scenarioShare } = await import("../src/lib/analysis/scenario");
    const best = { probability: 0.6, bias: 1 } as never;
    const alt = { probability: 0.2, bias: -1 } as never;
    const s = scenarioShare({ best, alternative: alt, contested: false })!;
    expect(s.main).toBeCloseTo(0.75, 6);
    expect(s.alt).toBeCloseTo(0.25, 6);
    expect(s.opposite).toBe(true);
    expect(s.state).toBe("gilt");
    expect(scenarioShare({ best, alternative: alt, contested: true })!.state).toBe("notfall");
    expect(scenarioShare({ best, alternative: undefined, contested: false })!.main).toBe(1);
    expect(scenarioShare({ best: undefined, alternative: undefined, contested: false })).toBeNull();
  });
});

describe("Punkte für blauen Langfrist-Kauf", () => {
  it("besseres Chance/Risiko und Trendfortsetzung geben mehr Punkte; Notfall zieht ab", async () => {
    const { longTermScore } = await import("../src/lib/analysis/longtermScore");
    const zone = (inv: number, context: "neuer Trend" | "Trendfortsetzung") => ({ zoneTop: 100, zoneBottom: 80, invalidation: inv, targets: [160, 250], context }) as never;
    const a = (contested = false) => ({ weights: { elliott: 60, fundamental: 20, volume: 20 }, fundamental: { score: 50 }, volume: { score: 50 }, elliott: { contested } }) as never;
    const good = longTermScore(zone(80, "Trendfortsetzung"), a()); // Chance 60 %, Risiko 20 % → CRV 3
    const weak = longTermScore(zone(40, "neuer Trend"), a()); // Risiko 60 % → CRV 1
    expect(good.crv).toBeCloseTo(3, 6);
    expect(good.chart).toBe(97);
    expect(weak.chart).toBe(53);
    expect(good.total).toBeGreaterThan(weak.total);
    expect(longTermScore(zone(80, "Trendfortsetzung"), a(true)).chart).toBe(82);
  });
});

describe("Handelsregeln an einer Stelle (Chancen, Turnier, EchoChart)", () => {
  it("Short nur im Bärenmarkt, Sektor-Regel, Chance ≥ 15 %, obere Hälfte nach Potenzial, Blau-Regel", async () => {
    const { greenRedTrade, blueTrade } = await import("../src/lib/analysis/tradeRules");
    const ctx = (bear: boolean, weak: boolean, symbol = "XOM") => ({ symbol, techWeakAt: () => weak, regimeAt: () => (bear ? ("baerisch" as const) : ("bullisch" as const)) });
    const long = { direction: "long", entryTime: 1, entry: 100, stop: 90, target: 140 };
    expect(greenRedTrade(long, ctx(false, false))).toMatchObject({ color: "gruen" });
    expect(greenRedTrade({ ...long, target: 110 }, ctx(false, false))).toBeNull(); // Chance nur 10 %
    expect(greenRedTrade(long, ctx(false, true, "NVDA"))).toBeNull(); // Tech bei schwachem NASDAQ
    const short = { direction: "short", entryTime: 1, entry: 100, stop: 110, target: 60 };
    expect(greenRedTrade(short, ctx(false, false))).toBeNull(); // kein Bärenmarkt
    expect(greenRedTrade(short, ctx(true, false))).toMatchObject({ color: "rot" });
    expect(blueTrade({ zoneTop: 100, invalidation: 80, target: 160 }).ok).toBe(true);
    expect(blueTrade({ zoneTop: 100, invalidation: 50, target: 160 }).ok).toBe(false);
  });
});
