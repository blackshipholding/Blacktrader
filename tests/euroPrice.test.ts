import { beforeEach, describe, expect, it, vi } from "vitest";
import { setFxRates } from "../src/lib/fx";

vi.mock("../src/lib/client/api", () => ({
  api: {
    quote: vi.fn(async (a: { binanceSymbol?: string; yahooSymbol?: string }) =>
      a.binanceSymbol === "ETHEUR" ? { price: 1820, currency: "EUR", time: 1, changePct: 0, delayed: false, source: "Binance" } : { price: 90, currency: "EUR", time: 2, changePct: 0, delayed: false, source: "Yahoo" },
    ),
    resolve: vi.fn(async () => ({ candidates: [{ kind: "stock", symbol: "APC.SG", yahooSymbol: "APC.SG" }] })),
  },
}));

import { euroQuote } from "../src/lib/client/euroPrice";

describe("Euro-Live-Kurs", () => {
  beforeEach(() => setFxRates({ USD: 0.9, USDT: 0.9 }));
  it("Krypto: Binance-Euro-Paar, Gegenwert in USDT passt zum Wechselkurs", async () => {
    const q = await euroQuote({ kind: "crypto", symbol: "ETH-USD", name: "Ethereum", binanceSymbol: "ETHUSDT" }, "USDT", 0);
    expect(q?.eur).toBe(1820);
    expect(q?.native).toBeCloseTo(1820 / 0.9, 6);
    expect(q!.native * 0.9).toBeCloseTo(1820, 6);
    expect(q?.source).toBe("Binance EUR");
  });
  it("Aktie (USD): Euro-Kurs der deutschen Börse", async () => {
    const q = await euroQuote({ kind: "stock", symbol: "AAPL", name: "Apple", isin: "US0378331005" }, "USD", 0);
    expect(q?.eur).toBe(90);
    expect(q?.source).toBe("Börse Stuttgart");
  });
  it("Rohstoff/Index: kein Euro-Kurs → null (bisheriger Kurs bleibt)", async () => {
    expect(await euroQuote({ kind: "commodity", symbol: "GC=F", name: "Gold", yahooSymbol: "GC=F" }, "USD", 0)).toBeNull();
  });
});
