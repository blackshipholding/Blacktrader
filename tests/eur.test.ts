import { describe, expect, it } from "vitest";
import { money } from "../src/lib/analysis/persona";
import { toEurReturn, tradeCurrency } from "../src/lib/client/eur";
import { eurPerUnit, setFxRates, toEur } from "../src/lib/fx";

describe("Alles in Euro", () => {
  it("Dollar-Preise werden zum aktuellen Kurs in Euro angezeigt", () => {
    setFxRates({ USD: 0.9 });
    expect(toEur(100, "USD")).toBeCloseTo(90);
    expect(eurPerUnit("USDT")).toBeCloseTo(0.9);
    expect(money(100, "USD")).toBe("90,00 €");
    expect(money(100, "EUR")).toBe("100,00 €");
  });
  it("Rendite in Euro enthält die Wechselkursänderung seit dem Kauf", () => {
    setFxRates({ USD: 0.95 });
    // +10 % in Dollar, Dollar seit dem Kauf von 0,90 € auf 0,95 € gestiegen → in Euro mehr
    const r = toEurReturn(10, { symbol: "AAPL", kind: "stock", currency: "USD", fxEntry: 0.9 });
    expect(r).toBeCloseTo((1.1 * 0.95) / 0.9 * 100 - 100, 6);
    // Euro-Werte bleiben unverändert
    expect(toEurReturn(10, { symbol: "SAP.DE", kind: "stock", currency: "EUR", fxEntry: 1 })).toBeCloseTo(10);
  });
  it("Währung älterer Trades wird aus Symbol und Art abgeleitet", () => {
    expect(tradeCurrency({ symbol: "SAP.DE", kind: "stock" })).toBe("EUR");
    expect(tradeCurrency({ symbol: "AAPL", kind: "stock" })).toBe("USD");
    expect(tradeCurrency({ symbol: "BTC", kind: "crypto" })).toBe("USDT");
  });
});
