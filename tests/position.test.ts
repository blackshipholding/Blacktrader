import { describe, expect, it, vi } from "vitest";

describe("Depot: eine Position je Wert (Erstkauf + Nachkauf)", () => {
  it("Summe, Teilverkauf zum Ø Einstieg, Gebühr nur einmal, Stop für alles, Orders ändern", async () => {
    const store = new Map<string, string>();
    const ls = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k), key: (i: number) => [...store.keys()][i] ?? null, get length() { return store.size; } };
    vi.stubGlobal("window", { localStorage: ls, addEventListener: () => {} });
    const base = { strategy: "longterm", status: "open", symbol: "SAP.DE", name: "SAP", kind: "stock", currency: "EUR", horizon: "long", interval: "1w", direction: "long", stop: 0, targets: [300], source: "manual", fxEntry: 1, partials: [], remaining: 1, lt: { zoneTop: 200, zoneBottom: 160, invalidation: 140, targets: [300], key: "k" } };
    const t1 = { ...base, id: "a", entry: 200, openedAt: 1, stakeEur: 500, tranches: [{ price: 200, filledAt: 1, qty: 1, eur: 200 }, { price: 150, qty: 2, eur: 300 }] };
    const t2 = { ...base, id: "b", entry: 100, openedAt: 2, nachkauf: true, stakeEur: 300, tranches: [{ price: 100, filledAt: 2, qty: 3, eur: 300 }] };
    store.set("black-ship-trading-analyst:v1", JSON.stringify({ version: 1, watchlist: [], settings: {}, signals: {}, migrations: ["v2-manual-journal", "v3-blacktrader"], trades: [t1, t2] }));
    const { getData } = await import("../src/lib/store/store");
    const P = await import("../src/lib/client/position");
    const { computeAccount } = await import("../src/lib/client/account");
    const group = () => P.blueGroups(getData().trades).get("stock:SAP.DE") ?? [];
    expect(group().map((t) => t.id)).toEqual(["a", "b"]);
    const s = P.positionSummary(group(), 125);
    expect(s.shares).toBe(4);
    expect(s.invested).toBe(500);
    expect(s.avgEur).toBe(125);
    expect(s.reserved).toBe(300);
    expect(s.profit).toBeCloseTo(0, 6);

    // Stop über dem Kurs geht nicht, darunter schon – für beide Käufe, Gebühr nur einmal
    expect(P.setPositionStop(group(), 125, 125)).toContain("0,5 %");
    expect(P.setPositionStop(group(), 110, 125)).toBeNull();
    expect(group().map((t) => [t.stop, !!t.sellFeeShared])).toEqual([[110, false], [110, true]]);
    P.clearPositionStop(group());

    // Wartende Order ändern: 150 € → 140 €, 3 Stück
    expect(P.updateWaitingOrder(group()[0], 1, 140, 3)).toBeNull();
    expect(group()[0].tranches![1]).toMatchObject({ price: 140, qty: 3, eur: 420 });
    expect(group()[0].stakeEur).toBe(620);

    // Hälfte verkaufen (2 von 4 Stück) zu 150 €: Gewinn = 2 × (150 − 125) = 50 €, eine Verkaufsgebühr
    expect(P.sellPosition(group(), 2, 150, false)).toContain("2 Stück");
    const s2 = P.positionSummary(group(), 150);
    expect(s2.shares).toBeCloseTo(2, 9);
    expect(s2.invested).toBeCloseTo(250, 9);
    const [a, b] = group();
    expect(a.partials![0].noFee).toBeUndefined();
    expect(b.partials![0].noFee).toBe(true);

    // Rest verkaufen und wartende Order löschen → beide geschlossen; Konto: Gewinn 50 + 50 = 100 €, Gebühren 2 Käufe + 2 Verkaufs-Orders
    P.sellPosition(group(), 2, 150, true);
    expect(group()).toHaveLength(0);
    const acc = computeAccount(getData().trades, [], () => null).at(-1)!;
    expect(acc.fees).toBeCloseTo(4 * 7.9, 6);
    expect(acc.equity).toBeCloseTo(8000 + 100 - 4 * 7.9 - 100 * 0.275, 6);
  });
});

describe("Getrennte flatex-Depots: jeder Kauf eigene Position", () => {
  it("Verkauf je Kauf: eigene Gebühr, Gewinn zum eigenen Einstieg; Depot beim Übernehmen vorbelegt", async () => {
    const store = new Map<string, string>();
    const ls = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k), key: (i: number) => [...store.keys()][i] ?? null, get length() { return store.size; } };
    vi.resetModules();
    vi.stubGlobal("window", { localStorage: ls, addEventListener: () => {} });
    const base = { strategy: "longterm", status: "open", symbol: "SOL", name: "Solana", kind: "crypto", currency: "EUR", horizon: "long", interval: "1w", direction: "long", stop: 0, targets: [200], source: "manual", fxEntry: 1, partials: [], remaining: 1 };
    const a = { ...base, id: "a", depot: 1, entry: 130, openedAt: 1, stakeEur: 260, tranches: [{ price: 130, filledAt: 1, qty: 2, eur: 260 }] };
    const b = { ...base, id: "b", depot: 2, nachkauf: true, entry: 110, openedAt: 2, stakeEur: 220, tranches: [{ price: 110, filledAt: 2, qty: 2, eur: 220 }] };
    store.set("black-ship-trading-analyst:v1", JSON.stringify({ version: 1, watchlist: [], settings: { lastDepot: 3 }, signals: {}, migrations: ["v2-manual-journal", "v3-blacktrader"], trades: [a, b] }));
    const { getData, actions } = await import("../src/lib/store/store");
    const P = await import("../src/lib/client/position");
    const { computeAccount } = await import("../src/lib/client/account");
    // nur den Nachkauf (Depot 2) verkaufen, zu 120 €: Gewinn 2 × (120 − 110) = 20 €
    const g = P.blueGroups(getData().trades).get("crypto:SOL")!;
    P.sellPosition([g[1]], 2, 120, false);
    const tr = getData().trades;
    expect(tr.find((t) => t.id === "b")!.status).toBe("closed");
    expect(tr.find((t) => t.id === "a")!.status).toBe("open");
    // dann Erstkauf (Depot 1) zu 120 €: Verlust 2 × (120 − 130) = −20 € → Verlustausgleich im Jahr
    P.sellPosition([P.blueGroups(getData().trades).get("crypto:SOL")![0]], 2, 120, false);
    const acc = computeAccount(getData().trades, [], () => null).at(-1)!;
    expect(acc.fees).toBeCloseTo(4 * 7.9, 6); // 2 Käufe + 2 getrennte Verkäufe
    expect(acc.equity).toBeCloseTo(8000 - 4 * 7.9, 6);
    // neuer Kauf bekommt das zuletzt gewählte Depot
    actions.addTrade({ symbol: "ETH", name: "Ethereum", kind: "crypto", horizon: "long", interval: "1w", direction: "long", entry: 1, stop: 0, targets: [2], openedAt: 3, reason: "", score: 0, signal: "buy", pattern: "" } as never);
    expect(getData().trades.find((t) => t.symbol === "ETH")!.depot).toBe(3);
  });
});

describe("Kauf über dem Kurs und Korrektur", () => {
  it("Teil über dem Kurs zählt zum Marktpreis; Kauf korrigieren behält den alten Stand", async () => {
    const L = await import("../src/lib/client/longterm");
    expect(L.effectiveLevels([105.61], 74.64)).toEqual([74.64]);
    expect(L.effectiveLevels([76, 68, 60], 74.64)).toEqual([74.64, 68, 60]);
    const store = new Map<string, string>();
    const ls = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k), key: (i: number) => [...store.keys()][i] ?? null, get length() { return store.size; } };
    vi.resetModules();
    vi.stubGlobal("window", { localStorage: ls, addEventListener: () => {} });
    const t = { id: "n", strategy: "longterm", status: "open", symbol: "SOL", name: "Solana", kind: "crypto", currency: "EUR", horizon: "long", interval: "1w", direction: "long", stop: 0, targets: [200], source: "manual", fxEntry: 1, partials: [], remaining: 1, nachkauf: true, entry: 105.61, openedAt: 1, stakeEur: 249.99, tranches: [{ price: 105.61, filledAt: 1, qty: 2.3668, eur: 249.99 }] };
    store.set("black-ship-trading-analyst:v1", JSON.stringify({ version: 1, watchlist: [], settings: {}, signals: {}, migrations: ["v2-manual-journal", "v3-blacktrader"], trades: [t] }));
    const { getData } = await import("../src/lib/store/store");
    const L2 = await import("../src/lib/client/longterm");
    expect(L2.correctFill(getData().trades[0], 0, 74.9, 3.34)).toBeNull();
    const n = getData().trades[0];
    expect(n.tranches![0]).toMatchObject({ price: 74.9, qty: 3.34 });
    expect(n.tranches![0].eur).toBeCloseTo(250.166, 3);
    expect(n.entry).toBeCloseTo(74.9, 6);
    expect(n.corrections![0].entry).toBe(105.61);
    expect(n.corrections![0].tranches[0].price).toBe(105.61);
  });
});

describe("Nachkauf-Sicherheitsregel: erst wenn die Zone des letzten Kaufs nach oben verlassen wurde", () => {
  it("Zone in der Zone (neues Hoch vor dem Kauf oder unter der alten Oberkante) → kein Nachkauf", async () => {
    const { nachkaufState } = await import("../src/lib/client/nachkauf");
    const held = [{ id: "z", strategy: "longterm", status: "open", symbol: "SOL", openedAt: Date.UTC(2026, 10, 10), lt: { zoneTop: 76, zoneBottom: 60, invalidation: 54, targets: [180], key: "k1" } }] as never;
    // neuer Bereich, dessen Hoch VOR dem Kauf entstand (Solana-Fall) → nein
    expect(nachkaufState("SOL", { key: "k2", high: { time: Date.UTC(2026, 0, 1) / 1000, price: 290 } }, held).allowed).toBe(false);
    // Hoch nach dem Kauf, aber nicht über der alten Oberkante → nein
    expect(nachkaufState("SOL", { key: "k3", high: { time: Date.UTC(2026, 11, 20) / 1000, price: 74 } }, held).allowed).toBe(false);
    // Hoch nach dem Kauf und über der alten Oberkante → ja
    expect(nachkaufState("SOL", { key: "k4", high: { time: Date.UTC(2026, 11, 20) / 1000, price: 120 } }, held).allowed).toBe(true);
  });
});
