import { describe, expect, it } from "vitest";
import { fillShares, makeOrderSlip } from "../src/lib/client/orderSlip";
import { refillWaiting } from "../src/lib/client/longterm";
import type { Trade } from "../src/lib/store/store";

describe("Stück bis 550 € je Trade (nicht je Teil)", () => {
  it("T-Mobile: 3 × 1 Stück → zusätzlich 1 Stück im passenden Teil (~498 €)", () => {
    const s = makeOrderSlip({ kind: "stock", symbol: "TMUS.DE", name: "T-Mobile", currency: "EUR", direction: "long", entry: 150.86, tranches: [150.86, 129.85, 108.84] });
    expect(s.orders.map((o) => o.qty)).toEqual([1, 1, 2]);
    expect(s.totalEur).toBeCloseTo(498.39, 2);
  });
  it("nie über 550 €, gekaufte Teile bleiben fest", () => {
    expect(fillShares([{ priceEur: 300, qty: 1, fixed: true }, { priceEur: 260, qty: 0 }], 500, 550)).toEqual([1, 0]);
    expect(fillShares([{ priceEur: 150, qty: 1, fixed: true }, { priceEur: 120, qty: 1 }, { priceEur: 100, qty: 1 }], 500, 550)).toEqual([1, 2, 1]);
  });
  it("günstige Aktien unverändert nah an 500 €", () => {
    const s = makeOrderSlip({ kind: "stock", symbol: "SAP.DE", name: "SAP", currency: "EUR", direction: "long", entry: 100, tranches: [100, 90, 80] });
    expect(Math.abs(s.totalEur - 500)).toBeLessThan(50);
    expect(s.totalEur).toBeLessThanOrEqual(550);
  });
  it("Krypto bleibt genau gedrittelt", () => {
    const s = makeOrderSlip({ kind: "crypto", symbol: "SOL", name: "Solana", currency: "EUR", direction: "long", entry: 76, tranches: [76, 68, 60] });
    s.orders.forEach((o) => expect(o.amountEur).toBeCloseTo(166.67, 0));
  });
  it("Back-Fix: offene Position T-Mobile → Teil 3 auf 2 Stück, mit Hinweis für flatex", () => {
    const t = { id: "x", strategy: "longterm", status: "open", kind: "stock", symbol: "TMUS", currency: "EUR", tranches: [{ price: 150.79, filledAt: 1, qty: 1, eur: 150.86 }, { price: 129.79, qty: 1, eur: 129.85 }, { price: 108.79, qty: 1, eur: 108.84 }] } as unknown as Trade;
    const r = refillWaiting(t)!;
    expect(r.tranches.map((x) => x.qty)).toEqual([1, 1, 2]);
    expect(r.stakeEur).toBeCloseTo(498.39, 2);
    expect(r.note).toContain("Teil 3 jetzt 2 Stück");
    expect(refillWaiting({ ...t, tranches: r.tranches })).toBeNull();
  });
});
