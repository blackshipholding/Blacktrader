import { describe, expect, it } from "vitest";
import { financeCheck } from "../src/lib/analysis/finance";
import { suppressedBy } from "../src/lib/analysis/tradeRules";
import { simulateAccount } from "../src/lib/client/account";
import { nachkaufState } from "../src/lib/client/nachkauf";
import { RULES, runWindow, type PoolTrade } from "../src/lib/trainer/tournament";

const D = 86400;
describe("Update: ein Signal, Nachkauf nur Blau, Finanz-Prüfung", () => {
  it("ein Signal wie in den Chancen: Tagessignal ruht, solange Wochen-Setup oder Blau im Bereich aktiv ist (Krypto umgekehrt)", () => {
    const act = { blau: [[100, 200]], "1d": [[300, 400]], "1w": [[500, 600]] };
    expect(suppressedBy("stock", "1d", 150, act)).toBe(true); // Blau im Bereich
    expect(suppressedBy("stock", "1d", 550, act)).toBe(true); // Woche vor Tag
    expect(suppressedBy("stock", "1w", 350, act)).toBe(false);
    expect(suppressedBy("crypto", "1w", 350, act)).toBe(true); // Krypto: Tag vor Woche
    expect(suppressedBy("crypto", "1d", 550, act)).toBe(false);
  });

  it("Turnier: Nachkauf nur bei Blau, höchstens 4 × 250 €; grünes Zweitsignal desselben Werts wird nicht gehandelt", () => {
    expect(RULES).toMatchObject({ addMax: 4, addStake: 250 });
    const w = { from: 0, to: 1000 * D, scenario: "bullisch" as const };
    const flat = () => 100;
    const lot = (entry: number, color: PoolTrade["color"]): PoolTrade => ({ sym: "X", entry: entry * D, exit: 900 * D, r: 0, px: 100, color });
    const blue = runWindow([lot(1, "blau"), ...[2, 3, 4, 5, 6].map((d) => lot(d, "blau"))], w, flat);
    expect(blue.trades).toBe(5); // 1 + 4 Nachkäufe
    expect(blue.fees).toBeCloseTo(10 * RULES.fee, 6);
    const green = runWindow([lot(1, "gruen"), lot(2, "gruen")], w, flat);
    expect(green.trades).toBe(1);
  });

  it("EchoChart-Konto: Nachkauf nur Blau mit 250 €", () => {
    const t = (d: number, blue: boolean) => ({ sym: "X", entry: d * D * 1000, exit: 900 * D * 1000, r: 10, blue });
    const r = simulateAccount([t(1, true), t(2, true), t(3, false)]);
    expect(r.taken).toBe(2);
    // Gewinn 50 € + 25 €, KESt 27,5 %, 4 Orders à 7,90 €
    expect(r.end).toBeCloseTo(8000 + 75 - 4 * 7.9 - 75 * 0.275, 6);
  });

  it("Depot: Nachkauf nur bei neuem blauen Bereich, höchstens 4", () => {
    const base = { kind: "stock", horizon: "long", direction: "long", entry: 100, stop: 0, targets: [150], openedAt: 1, reason: "", score: 0, signal: "buy", pattern: "", status: "open", strategy: "longterm" } as const;
    const pos = [{ ...base, id: "a", symbol: "X", name: "X", lt: { key: "k1", zoneTop: 1, zoneBottom: 1, invalidation: 1, targets: [] } }] as never[];
    expect(nachkaufState("X", { key: "k1" }, pos).allowed).toBe(false); // gleicher Bereich
    expect(nachkaufState("X", { key: "k2" }, pos)).toMatchObject({ allowed: true, left: 4 });
    expect(nachkaufState("X", null, pos).allowed).toBe(false); // kein Blau
    expect(nachkaufState("Y", { key: "k2" }, pos).allowed).toBe(false); // nicht im Depot
    const full = [...pos, ...[2, 3, 4, 5].map((i) => ({ ...base, id: `n${i}`, symbol: "X", name: "X", nachkauf: true, lt: { key: `n${i}` } }))] as never[];
    expect(nachkaufState("X", { key: "k9" }, full)).toMatchObject({ allowed: false, left: 0 });
    expect(nachkaufState("X", { key: "k2" }, pos, true).allowed).toBe(false); // Finanzen schwach
  });

  it("Finanz-Prüfung: hohe Schulden UND (Geld verbrennen / große Verluste / Umsatzeinbruch)", () => {
    const f = (debtToEquity: number, freeCashflow: number, profitMargin: number, revenueGrowth: number) => ({ kind: "stock" as const, source: "t", debtToEquity, freeCashflow, profitMargin, revenueGrowth });
    expect(financeCheck(f(45224, 728e6, -1.51, -0.8)).weak).toBe(true); // wie FMC
    expect(financeCheck(f(280, 2e9, 0.26, -0.01)).weak).toBe(false); // wie Zoetis
    expect(financeCheck(f(4, -73e6, 0, -0.01)).weak).toBe(false); // wie D-Wave: kaum Schulden
    expect(financeCheck(f(718, -7e6, -0.5, 0.1)).weak).toBe(true); // wie Beyond Meat
    expect(financeCheck(null).weak).toBe(false);
  });
});
