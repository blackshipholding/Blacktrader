import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PARAMS } from "../src/lib/analysis/params";
import { applyProposal, cellStorageKey, emptyRecord, mergeRecords, rollbackRecord, type Proposal } from "../src/lib/trainer/cells";
import { loadAllCells, loadCell, serverCells } from "../src/lib/trainer/cellStore";
import type { Metrics } from "../src/lib/trainer/engine";
import { CELL_KEYS, type CellKey } from "../src/lib/trainer/universe";

const m = (hitRate: number, o: Partial<Metrics> = {}): Metrics => ({ trades: 3000, hitRate, avgWin: 3, avgLoss: -2, profitFactor: 1.5, maxDrawdown: -10, perMonth: 4, ...o });
const better = (from: number, to: number, zone = 4.5): Proposal => ({ baseParams: DEFAULT_PARAMS, base: m(from), cand: m(to, { profitFactor: 1.6 }), deployed: { ...DEFAULT_PARAMS, zoneAtrMult: zone }, source: "Test" });

beforeEach(() => (globalThis as unknown as { __trainerMem?: Map<string, string> }).__trainerMem?.clear());

describe("Getrennte Speicherung je Klasse × Horizont", () => {
  it("jede Zelle hat einen eigenen Schlüssel", () => {
    expect(cellStorageKey("crypto:short")).toBe("trainer:krypto:kurz");
    expect(cellStorageKey("stock:medium")).toBe("trainer:aktien:mittel");
    expect(cellStorageKey("commodity:long")).toBe("trainer:rohstoffe:lang");
    expect(new Set(CELL_KEYS.map(cellStorageKey)).size).toBe(9);
  });

  it("Aktien → Krypto → Rohstoffe trainieren: alle drei Werte bleiben sichtbar und korrekt", async () => {
    await serverCells.propose("stock:short", better(0.4, 0.45));
    await serverCells.propose("crypto:short", better(0.42, 0.48));
    await serverCells.propose("commodity:short", better(0.3, 0.36));
    const all = await loadAllCells();
    const get = (c: CellKey) => all.find((r) => r.cell === c)!;
    expect(get("stock:short").current?.hitRate).toBe(0.45);
    expect(get("crypto:short").current?.hitRate).toBe(0.48);
    expect(get("commodity:short").current?.hitRate).toBe(0.36);
    expect(get("stock:short").params).toEqual({ zoneAtrMult: 4.5 });
    // auch nach „Neuladen“ (frisch gelesen)
    expect((await loadCell("stock:short")).current?.hitRate).toBe(0.45);
  });

  it("ein Lauf für eine Klasse verändert die anderen nie", async () => {
    await serverCells.propose("stock:short", better(0.4, 0.45));
    const before = JSON.stringify(await loadCell("stock:short"));
    await serverCells.propose("crypto:short", better(0.42, 0.48));
    await serverCells.propose("crypto:short", { ...better(0.48, 0.3), baseParams: { ...DEFAULT_PARAMS, zoneAtrMult: 4.5 } }); // schlechter
    expect(JSON.stringify(await loadCell("stock:short"))).toBe(before);
  });

  it("gleichzeitige Speichervorgänge für verschiedene Zellen gehen nicht verloren", async () => {
    await Promise.all(CELL_KEYS.map((c, i) => serverCells.propose(c, better(0.4, 0.45 + i / 100))));
    const all = await loadAllCells();
    for (const [i, c] of CELL_KEYS.entries()) expect(all.find((r) => r.cell === c)!.current?.hitRate).toBeCloseTo(0.45 + i / 100);
  });

  it("gleichzeitig dieselbe Zelle: nur eins wird gespeichert, das andere sieht den geänderten Ausgangsstand", async () => {
    const [a, b] = await Promise.all([serverCells.propose("stock:long", better(0.4, 0.45, 4.5)), serverCells.propose("stock:long", better(0.4, 0.47, 3.5))]);
    expect([a.saved, b.saved].filter(Boolean)).toHaveLength(1);
    expect((a.saved ? b : a).decision.reasons[0]).toMatch(/Ausgangsstand/);
  });
});

describe("Nur speichern, wenn besser", () => {
  it("besser → gespeichert mit Meldung, vorheriger Stand bleibt als Vergleich", () => {
    const out = applyProposal(emptyRecord("crypto:short"), better(0.449, 0.48));
    expect(out.saved).toBe(true);
    expect(out.message).toBe("Gespeichert: Krypto kurzfristig 44,9 % → 48,0 %");
    expect(out.record.previous?.hitRate).toBe(0.449);
    expect(out.record.current?.hitRate).toBe(0.48);
  });
  it("schlechter oder gleich → Werte und Stand bleiben", () => {
    const first = applyProposal(emptyRecord("crypto:short"), better(0.449, 0.48)).record;
    const out = applyProposal(first, { ...better(0.48, 0.46), baseParams: { ...DEFAULT_PARAMS, zoneAtrMult: 4.5 }, deployed: { ...DEFAULT_PARAMS, zoneAtrMult: 5 } });
    expect(out.saved).toBe(false);
    expect(out.record.params).toEqual({ zoneAtrMult: 4.5 });
    expect(out.record.current?.hitRate).toBe(0.48);
    expect(out.message).toMatch(/alter Stand bleibt/);
  });
  it("Strenge-Regel: Profit-Faktor darf nicht sinken", () => {
    const out = applyProposal(emptyRecord("stock:short"), { ...better(0.4, 0.5), cand: m(0.5, { profitFactor: 1.2 }) });
    expect(out.saved).toBe(false);
  });
  it("Zurücksetzen betrifft nur diese Zelle", () => {
    const r1 = applyProposal(emptyRecord("stock:medium"), better(0.4, 0.45)).record;
    const r0 = rollbackRecord(r1)!;
    expect(r0.params).toEqual({});
    expect(r0.cell).toBe("stock:medium");
  });
});

describe("Lokale Kopie + Server", () => {
  it("je Zelle gewinnt der jüngere Stand, andere Zellen bleiben", () => {
    const s = { "stock:short": { updatedAt: "2026-01-02T00:00:00Z", v: "server" }, "crypto:short": { updatedAt: "2026-01-05T00:00:00Z", v: "server" } };
    const l = { "stock:short": { updatedAt: "2026-01-03T00:00:00Z", v: "lokal" }, "commodity:long": { updatedAt: "2026-01-01T00:00:00Z", v: "lokal" } };
    const out = mergeRecords(s, l);
    expect(out["stock:short"]?.v).toBe("lokal");
    expect(out["crypto:short"]?.v).toBe("server");
    expect(out["commodity:long"]?.v).toBe("lokal");
  });
});

// Sofort-Speichern: Verbesserung wird während des Laufs gemeldet, nicht erst am Ende
vi.mock("../src/lib/trainer/walkforward", async (orig) => {
  const mod = await orig<typeof import("../src/lib/trainer/walkforward")>();
  let calls = 0;
  return {
    ...mod,
    improvementCheck: (st: Parameters<typeof mod.improvementCheck>[0], last: Parameters<typeof mod.improvementCheck>[1]) => {
      if (last || ++calls < 2) return null; // genau eine Verbesserung, nach dem ersten Arbeitsblock
      return { base: m(0.449), cand: m(0.48), decision: { accept: true, reasons: [] }, deployed: { ...DEFAULT_PARAMS, zoneAtrMult: 4.5 }, changes: "zoneAtrMult 4 → 4.5", improved: true };
    },
  };
});

describe("Sofort speichern", () => {
  it("speichert eine Verbesserung sofort – vor dem Ende des Bereichs und der Sitzung", async () => {
    const { newSession, runSession } = await import("../src/lib/trainer/session");
    const { randomWalk } = await import("./golden/fixtures");
    const events: string[] = [];
    const st = newSession({ id: "s", durationMs: 600_000, cells: ["crypto:short", "crypto:medium"], baseVersion: 0, paramSet: {}, extra: [], baseParams: {} });
    await runSession(st, {
      load: async () => randomWalk(3, 700),
      onProgress: () => {},
      onImprovement: async (cell) => {
        events.push(`gespeichert:${cell}`);
        return true;
      },
      onCellDone: (o) => void events.push(`fertig:${o.cell}`),
      shouldStop: () => events.length >= 3,
      chunkMs: 200,
    });
    expect(events[0]).toBe("gespeichert:crypto:short");
    expect(events.indexOf("gespeichert:crypto:short")).toBeLessThan(events.indexOf("fertig:crypto:short"));
    expect(st.saved["crypto:short"]?.oos.hitRate).toBe(0.48);
  }, 120_000);
});
