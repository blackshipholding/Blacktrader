import { describe, expect, it } from "vitest";
import { creditsFor, mergeEvents, PAY_LAG_DAYS, sharesAtEx, upcomingFor } from "../src/lib/analysis/dividends";
import { __setRawDividends, creditsOfHolding, lotsOfHolding, lotsOfTrade } from "../src/lib/client/dividendBook";
import { computeRound } from "../src/lib/client/account";
import type { Holding } from "../src/lib/client/holdings";
import type { Trade } from "../src/lib/store/store";

const D = 86400e3;
const ms = (s: string) => Date.parse(`${s}T00:00:00Z`);
const sec = (s: string) => ms(s) / 1000;

describe("Dividenden: Anspruch und Auszahlung", () => {
  const ev = mergeEvents([{ time: sec("2025-03-10"), amount: 1 }]);
  it("Zahltag = Ex-Tag + 21 Tage, Korrektur von Hand wirkt", () => {
    expect(ev[0].pay).toBe(ms("2025-03-10") + PAY_LAG_DAYS * D);
    const e2 = mergeEvents([{ time: sec("2025-03-10"), amount: 1 }], [{ ex: ms("2025-03-10"), amount: 1.5, pay: ms("2025-03-20") }]);
    expect(e2[0].amount).toBe(1.5);
    expect(e2[0].pay).toBe(ms("2025-03-20"));
    expect(e2[0].edited).toBe(true);
    const e3 = mergeEvents([], [{ ex: ms("2025-06-01"), amount: 2, manual: true }]);
    expect(e3).toHaveLength(1);
    expect(e3[0].manual).toBe(true);
  });
  it("Anspruch: vor dem Ex-Tag gekauft; am Ex-Tag gekauft = nichts; am/nach Ex-Tag verkauft = behält; davor verkauft = nichts", () => {
    const ex = ms("2025-03-10");
    expect(sharesAtEx([{ qty: 5, from: ms("2025-03-09") }], ex)).toBe(5);
    expect(sharesAtEx([{ qty: 5, from: ms("2025-03-10") }], ex)).toBe(0);
    expect(sharesAtEx([{ qty: 5, from: ms("2025-01-01"), to: ms("2025-03-10") }], ex)).toBe(5);
    expect(sharesAtEx([{ qty: 5, from: ms("2025-01-01"), to: ms("2025-03-09") }], ex)).toBe(0);
  });
  it("Gutschrift erst ab Zahltag; vorher nur „erwartet“", () => {
    const lots = [{ qty: 10, from: ms("2025-01-01") }];
    expect(creditsFor(lots, ev, ms("2025-03-15"))).toHaveLength(0);
    expect(upcomingFor(lots, ev, ms("2025-03-15"))).toHaveLength(1);
    const c = creditsFor(lots, ev, ms("2025-04-05"));
    expect(c).toHaveLength(1);
    expect(c[0].gross).toBe(10);
    expect(creditsFor(lots, mergeEvents([{ time: sec("2025-03-10"), amount: 1 }], [{ ex: ms("2025-03-10"), skip: true }]), ms("2025-04-05"))).toHaveLength(0);
  });
});

describe("Dividenden: Buy & Hold und Blacktrader-Konto", () => {
  const h = { id: "h", symbol: "ZZDIV", name: "Div AG", kind: "stock", currency: "EUR", txs: [{ id: "1", type: "buy", date: "2025-01-02", qty: 10, price: 50, fee: 0 }] } as unknown as Holding;
  it("Buy & Hold: automatische Dividende ab Kaufdatum, Handeintrag geht vor", () => {
    __setRawDividends("ZZDIV", [{ time: sec("2025-03-10"), amount: 1 }]);
    const lots = lotsOfHolding(h);
    expect(lots).toEqual([{ qty: 10, from: ms("2025-01-02") }]);
    const auto = creditsOfHolding(h, ms("2026-01-01"));
    expect(auto).toHaveLength(1);
    expect(auto[0].grossEur).toBeCloseTo(10, 8);
    const withManual = { ...h, txs: [...h.txs, { id: "2", type: "div", date: "2025-03-31", qty: 1, price: 9, fee: 0 }] } as unknown as Holding;
    expect(creditsOfHolding(withManual, ms("2026-01-01"))).toHaveLength(0);
  });
  it("Blacktrader: Dividende am Zahltag aufs Konto, 27,5 % KESt", () => {
    __setRawDividends("ZZDIV", [{ time: sec("2025-03-10"), amount: 1 }]);
    const t = { id: "t1", symbol: "ZZDIV", name: "Div AG", kind: "stock", currency: "EUR", direction: "long", strategy: "zone", status: "open", openedAt: ms("2025-01-02"), shares: 100, stakeEur: 5000, entry: 50, fxEntry: 1, stop: 40, targets: [60], horizon: "medium", interval: "1d", reason: "", score: 60, signal: "buy" } as unknown as Trade;
    expect(lotsOfTrade(t)).toEqual([{ qty: 100, from: ms("2025-01-02"), to: undefined }]);
    const before = computeRound([t], 0, undefined, 1, () => null);
    // heute (Tests laufen nach 2026) → Dividende ist ausgezahlt: 100 × 1 € = 100 € brutto, 72,50 € netto
    expect(before.dividendsGross).toBeCloseTo(100, 6);
    expect(before.dividends).toBeCloseTo(72.5, 6);
    expect(before.tax).toBeCloseTo(27.5, 6);
    const none = computeRound([{ ...t, openedAt: ms("2025-03-10") }], 0, undefined, 1, () => null);
    expect(none.dividends).toBe(0);
  });
});
