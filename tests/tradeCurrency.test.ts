import { describe, expect, it, vi } from "vitest";

describe("Trades ohne Währung (z. B. aus der Watchlist)", () => {
  it("bekommen die richtige Währung und den echten Wechselkurs; alter Kurs 1 bei Dollar-Werten wird verworfen", async () => {
    const store = new Map<string, string>();
    const ls = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k), key: (i: number) => [...store.keys()][i] ?? null, get length() { return store.size; } };
    vi.stubGlobal("window", { localStorage: ls, addEventListener: () => {} });
    const old = {
      version: 1, watchlist: [], settings: {}, signals: {}, migrations: ["v2-manual-journal", "v3-blacktrader"],
      trades: [
        { id: "a", symbol: "TEAM", name: "Atlassian", kind: "stock", horizon: "medium", direction: "long", status: "open", entry: 100, stop: 90, targets: [120], openedAt: 1, source: "manual", fxEntry: 1 },
        { id: "b", symbol: "SAP.DE", name: "SAP", kind: "stock", horizon: "medium", direction: "long", status: "open", entry: 200, stop: 180, targets: [240], openedAt: 1, source: "manual", fxEntry: 1 },
      ],
    };
    store.set("black-ship-trading-analyst:v1", JSON.stringify(old));
    const { setFxRates } = await import("../src/lib/fx");
    setFxRates({ USD: 0.9 });
    const { getData, actions } = await import("../src/lib/store/store");
    const d = getData();
    expect(d.trades.find((t) => t.id === "a")).toMatchObject({ currency: "USD", fxEntry: undefined });
    expect(d.trades.find((t) => t.id === "b")).toMatchObject({ currency: "EUR", fxEntry: 1 });
    actions.addTrade({ symbol: "AAPL", name: "Apple", kind: "stock", horizon: "medium", interval: "1d", direction: "long", entry: 100, stop: 90, targets: [120], openedAt: 2, reason: "", score: 50, signal: "buy", pattern: "" } as never);
    const t = getData().trades.find((x) => x.symbol === "AAPL")!;
    expect(t.currency).toBe("USD");
    expect(t.fxEntry).toBeCloseTo(0.9, 6);
  });
});
