import { describe, expect, it } from "vitest";
import { dividendPerShareEur, myShares, netOfTax } from "../src/lib/client/dividends";
import type { Holding } from "../src/lib/client/holdings";
import type { Trade } from "../src/lib/store/store";

describe("Dividenden", () => {
  it("netto = brutto minus 27,5 % KESt, keine Gebühr", () => {
    expect(netOfTax(100)).toBeCloseTo(72.5, 10);
  });
  it("Dividende je Anteil: Rate, sonst Rendite × Kurs; ohne Dividende null", () => {
    const base = { kind: "stock" as const, source: "t", currency: "EUR" };
    expect(dividendPerShareEur({ ...base, dividendRate: 2.4 })).toBeCloseTo(2.4, 10);
    expect(dividendPerShareEur({ ...base, dividendYield: 0.03 }, 100)).toBeCloseTo(3, 10);
    expect(dividendPerShareEur({ ...base })).toBeNull();
    expect(dividendPerShareEur(null)).toBeNull();
  });
  it("deine Anteile: Buy & Hold + offene Blacktrader-Käufe, nicht wartende/geschlossene", () => {
    const h = { id: "h", kind: "stock", symbol: "AAPL", name: "Apple", txs: [{ id: "t1", type: "buy", date: "2025-01-01", qty: 4, price: 100, fee: 0 }] } as unknown as Holding;
    const mk = (o: Partial<Trade>) => ({ kind: "stock", symbol: "AAPL", direction: "long", strategy: "trade", status: "open", shares: 3, ...o }) as unknown as Trade;
    const q = myShares("stock", "AAPL", [h], [mk({}), mk({ status: "pending" }), mk({ status: "closed" }), mk({ symbol: "MSFT" })]);
    expect(q).toBe(7);
  });
});
