import { describe, expect, it, vi } from "vitest";

describe("Langfrist: Vorschlag statt automatischem Verkauf (wie bei flatex)", () => {
  it("Vorschlag → Schritte für flatex → erst nach Bestätigung gebucht; Ablehnen ändert nichts", async () => {
    const store = new Map<string, string>();
    const ls = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k), key: (i: number) => [...store.keys()][i] ?? null, get length() { return store.size; } };
    vi.stubGlobal("window", { localStorage: ls, addEventListener: () => {} });
    const lt = { id: "t1", strategy: "longterm", status: "open", symbol: "IFX.DE", name: "Infineon", kind: "stock", currency: "EUR", horizon: "long", interval: "1w", direction: "long", entry: 56.05, stop: 0, targets: [88], openedAt: 1, source: "manual", fxEntry: 1, lt: { zoneTop: 56.05, zoneBottom: 41.83, invalidation: 35.78, targets: [88], key: "k" }, tranches: [{ price: 56.05, filledAt: 1, qty: 3, eur: 168.15 }, { price: 48.94, filledAt: 2, qty: 3, eur: 146.82 }, { price: 41.83, qty: 4, eur: 167.32 }], partials: [], remaining: 1 };
    store.set("black-ship-trading-analyst:v1", JSON.stringify({ version: 1, watchlist: [], settings: {}, signals: {}, migrations: ["v2-manual-journal", "v3-blacktrader"], trades: [lt, { ...lt, id: "t2" }] }));
    const { getData } = await import("../src/lib/store/store");
    const L = await import("../src/lib/client/longterm");
    const get = (id: string) => getData().trades.find((t) => t.id === id)!;

    // Teilausstieg: 50 % verkaufen, Stop 50 € (Kurs 60 €)
    const p = L.makeProposal({ kind: "teilausstieg", key: "w5:1", fraction: 0.5, stop: 50, reason: "Welle 5 fertig." }, 60);
    expect(p.kind).toBe("teilausstieg");
    const { actions } = await import("../src/lib/store/store");
    actions.updateTrade("t1", { proposal: p });
    // noch nichts gebucht
    expect(get("t1").partials).toEqual([]);
    expect(get("t1").stop).toBe(0);
    const steps = L.proposalSteps(get("t1"));
    expect(steps[0]).toBe("Verkauf 3 Stück (bestens)");
    expect(steps[1]).toContain("Stop-Loss für die restlichen 3 Stück: 50,00 €");
    expect(steps[2]).toContain("wartende Kauf-Order 41,83 € löschen");
    // wartende Limit-Order läuft bei flatex weiter, solange nicht bestätigt
    L.trackLongTerm(get("t1"), 41);
    expect(get("t1").tranches!.every((x) => x.filledAt)).toBe(true);
    actions.updateTrade("t1", { tranches: lt.tranches });
    // Bestätigen zum eingegebenen Kurs
    L.acceptProposal(get("t1"), 61);
    expect(get("t1").proposal).toBeUndefined();
    expect(get("t1").partials![0]).toMatchObject({ fraction: 0.5, price: 61 });
    expect(get("t1").stop).toBe(50);
    expect(get("t1").brokerStopEur).toBe(50);
    expect(get("t1").tranches!.length).toBe(2);

    // Stop über dem Kurs → bei flatex nicht möglich → jetzt verkaufen
    const q = L.makeProposal({ kind: "stop", key: "alt:1", stop: 59.9, reason: "Zählung geändert." }, 60);
    expect(q.kind).toBe("ausstieg");
    expect(q.reason).toContain("jetzt verkaufen");

    // Ablehnen: nichts ändert sich, Meldung kommt nicht wieder
    actions.updateTrade("t2", { proposal: L.makeProposal({ kind: "ausstieg", key: "inv:35.78", reason: "ungültig" }, 35) });
    L.declineProposal(get("t2"));
    expect(get("t2")).toMatchObject({ status: "open", lastActionKey: "inv:35.78" });
    expect(get("t2").proposal).toBeUndefined();
  });
});
