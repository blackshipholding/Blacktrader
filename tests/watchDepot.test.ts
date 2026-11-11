import { describe, expect, it, vi } from "vitest";

describe("Wert ins Depot übernommen → verschwindet aus der Watchlist", () => {
  it("beim Übernehmen und einmalig für ältere Daten", async () => {
    const store = new Map<string, string>();
    const ls = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k), key: (i: number) => [...store.keys()][i] ?? null, get length() { return store.size; } };
    vi.stubGlobal("window", { localStorage: ls, addEventListener: () => {} });
    const old = {
      version: 1, settings: {}, signals: {}, migrations: ["v2-manual-journal", "v3-blacktrader"],
      watchlist: [
        { id: "w1", symbol: "IFX.DE", name: "Infineon", kind: "stock", addedAt: 1 },
        { id: "w2", symbol: "SAP.DE", name: "SAP", kind: "stock", addedAt: 1 },
        { id: "w3", symbol: "AAPL", name: "Apple", kind: "stock", addedAt: 1 },
      ],
      trades: [{ id: "a", symbol: "IFX.DE", name: "Infineon", kind: "stock", horizon: "long", direction: "long", status: "open", entry: 50, stop: 0, targets: [88], openedAt: 1, source: "manual", fxEntry: 1 }],
    };
    store.set("black-ship-trading-analyst:v1", JSON.stringify(old));
    const { getData, actions } = await import("../src/lib/store/store");
    actions.pruneWatchHeld();
    expect(getData().watchlist.map((w) => w.symbol)).toEqual(["SAP.DE", "AAPL"]);
    actions.addTrade({ symbol: "AAPL", name: "Apple", kind: "stock", horizon: "medium", interval: "1d", direction: "long", entry: 100, stop: 90, targets: [120], openedAt: 2, reason: "", score: 50, signal: "buy", pattern: "" } as never);
    expect(getData().watchlist.map((w) => w.symbol)).toEqual(["SAP.DE"]);
  });
});
