import { describe, expect, it, vi } from "vitest";

describe("Update: Journal nur mit selbst übernommenen Trades", () => {
  it("legt Backup an, entfernt automatische Kernpositionen, behält Watchlist/Einstellungen und fragt bei unklaren Trades", async () => {
    const store = new Map<string, string>();
    const ls = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() {
        return store.size;
      },
    };
    vi.stubGlobal("window", { localStorage: ls, addEventListener: () => {} });
    const old = {
      version: 1,
      watchlist: [{ id: "w1", kind: "stock", symbol: "AAPL", name: "Apple", addedAt: 1 }],
      settings: { pollSeconds: 45, autoTrade: true },
      signals: {},
      trades: [
        { id: "a", strategy: "core", symbol: "AAPL", name: "Apple", status: "open", entry: 1, stop: 0, targets: [], openedAt: 1 },
        { id: "b", symbol: "AAPL", name: "Apple", status: "open", entry: 1, stop: 0.9, targets: [1.2], openedAt: 1 },
      ],
    };
    store.set("black-ship-trading-analyst:v1", JSON.stringify(old));
    const { getData, listBackups, readBackup, actions } = await import("../src/lib/store/store");
    const d = getData();
    expect(d.watchlist).toHaveLength(1);
    expect(d.settings.pollSeconds).toBe(45);
    expect(d.settings.autoTrade).toBe(false);
    expect(d.trades.map((t) => t.id)).toEqual(["b"]);
    expect(d.trades[0].unverified).toBe(true);
    expect(d.migrationNotice).toMatchObject({ removedAuto: 1, unverified: 1 });
    const backups = listBackups();
    expect(backups).toHaveLength(1);
    expect(JSON.parse(readBackup(backups[0].key)!).trades).toHaveLength(2);
    actions.resolveUnverified(true);
    expect(getData().trades[0]).toMatchObject({ id: "b", unverified: false, source: "manual" });
    // neue Trades sind immer "manual"
    actions.addTrade({ symbol: "X", name: "X", kind: "stock", direction: "long", horizon: "short", interval: "1h", entry: 1, stop: 0.9, targets: [1.1], openedAt: 2, reason: "", score: 60, signal: "buy" });
    expect(getData().trades[1].source).toBe("manual");
    vi.unstubAllGlobals();
  });
});
