import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

const resp = (instrumentType: string) => ({
  chart: {
    result: [
      {
        meta: { symbol: "AAPL", currency: "USD", regularMarketPrice: 200, regularMarketTime: 1000, previousClose: 198, instrumentType },
        timestamp: [900, 1000, 1300, 1600],
        indicators: { quote: [{ open: [], high: [], low: [], volume: [], close: [199, 200, 201.5, null] }] },
      },
    ],
    error: null,
  },
});

let type = "EQUITY";
vi.mock("../src/lib/data/http", async (orig) => {
  const m = await orig<typeof import("../src/lib/data/http")>();
  return { ...m, fetchJson: vi.fn(async () => resp(type)) };
});

import { yahooQuote } from "../src/lib/data/yahoo";

describe("Yahoo: Vor-/Nachbörse", () => {
  it("Aktie: neuerer Kurs nach Handelsschluss wird genommen", async () => {
    type = "EQUITY";
    const q = await yahooQuote("AAPL");
    expect(q.price).toBe(201.5);
    expect(q.time).toBe(1300);
    expect(q.source).toBe("Yahoo Vor-/Nachbörse");
  });
  it("Krypto/Futures: unverändert regulärer Kurs", async () => {
    type = "FUTURE";
    const q = await yahooQuote("GC=F");
    expect(q.price).toBe(200);
    expect(q.source).toBe("Yahoo Finance");
  });
});
