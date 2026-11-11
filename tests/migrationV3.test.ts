import { describe, expect, it, vi } from "vitest";

describe("Blacktrader-Update: Nutzerdaten bleiben, vorher JSON-Backup", () => {
  it("legt ein Backup an und lässt offene Trades samt Zeitraum unverändert", async () => {
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
      settings: { pollSeconds: 45 },
      signals: {},
      migrations: ["v2-manual-journal"],
      trades: [{ id: "b", symbol: "AAPL", name: "Apple", kind: "stock", horizon: "short", direction: "long", status: "open", entry: 1, stop: 0.9, targets: [1.2], openedAt: 1, source: "manual" }],
    };
    const raw = JSON.stringify(old);
    store.set("black-ship-trading-analyst:v1", raw);
    const { getData, listBackups, readBackup } = await import("../src/lib/store/store");
    const d = getData();
    expect(d.migrations).toContain("v3-blacktrader");
    expect(d.trades).toHaveLength(1);
    expect(d.trades[0]).toMatchObject({ horizon: "short", status: "open", stop: 0.9 });
    const backups = listBackups();
    expect(backups).toHaveLength(1);
    expect(readBackup(backups[0].key)).toBe(raw);
  });
});
