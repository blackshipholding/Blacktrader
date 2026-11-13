import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PARAMS } from "../src/lib/analysis/params";
import type { Metrics } from "../src/lib/trainer/engine";
import { hash01, pickSubset } from "../src/lib/trainer/retest";

const mem = new Map<string, string>();
vi.stubGlobal("localStorage", { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) });

const m = (rate: number): Metrics => ({ trades: 300, hitRate: 0.4, avgWin: 10, avgLoss: -5, profitFactor: 1.5, maxDrawdown: -50, perMonth: 1, zones: 300, zoneRate: rate });

describe("Trainer-Vorschläge", () => {
  beforeEach(() => {
    mem.clear();
    vi.resetModules();
  });
  const mk = async () => {
    const P = await import("../src/lib/client/proposals");
    const dep = { ...DEFAULT_PARAMS, zoneAtrMult: 4.5 };
    const p = P.addProposal("stock:medium", { baseParams: DEFAULT_PARAMS, deployed: dep, base: m(0.8), cand: m(0.85), changes: "zoneAtrMult 4 → 4.5" }, new Date("2026-11-13T10:00:00Z"))!;
    return { P, p };
  };
  it("neuer Vorschlag ist 'testing', am Fundtag nicht fällig, am nächsten Tag fällig", async () => {
    const { P, p } = await mk();
    expect(p.status).toBe("testing");
    expect(P.dueForRetest("2026-11-13")).toHaveLength(0);
    expect(P.dueForRetest("2026-11-14")).toHaveLength(1);
  });
  it("derselbe Stand wird nicht doppelt angelegt, ein neuer ersetzt den alten", async () => {
    const { P } = await mk();
    expect(P.addProposal("stock:medium", { baseParams: DEFAULT_PARAMS, deployed: { ...DEFAULT_PARAMS, zoneAtrMult: 4.5 }, base: m(0.8), cand: m(0.85), changes: "x" })).toBeNull();
    P.addProposal("stock:medium", { baseParams: DEFAULT_PARAMS, deployed: { ...DEFAULT_PARAMS, zoneAtrMult: 5 }, base: m(0.8), cand: m(0.86), changes: "y" });
    expect(P.getProposals().filter(P.isActive)).toHaveLength(1);
  });
  it("5 verschiedene Tage bestanden → bereit; derselbe Tag zählt nur einmal", async () => {
    const { P, p } = await mk();
    expect(P.REQUIRED_DAYS).toBe(5);
    P.recordCheck(p.id, { day: "2026-11-14", pass: true, note: "ok" });
    expect(P.recordCheck(p.id, { day: "2026-11-14", pass: true, note: "ok" })).toBeNull();
    for (const d of ["15", "16", "17"]) P.recordCheck(p.id, { day: `2026-11-${d}`, pass: true, note: "ok" });
    expect(P.getProposals()[0].status).toBe("testing");
    P.recordCheck(p.id, { day: "2026-11-18", pass: true, note: "ok" });
    expect(P.getProposals()[0].status).toBe("ready");
  });
  it("ein Durchfall an einem Tag verwirft den Vorschlag", async () => {
    const { P, p } = await mk();
    P.recordCheck(p.id, { day: "2026-11-14", pass: true, note: "ok" });
    P.recordCheck(p.id, { day: "2026-11-15", pass: false, note: "zu wenige Zonen" });
    expect(P.getProposals()[0].status).toBe("rejected");
  });
});

describe("Ausschnitt je Tag", () => {
  const specs = Array.from({ length: 500 }, (_, i) => ({ symbol: `S${i}` }));
  it("am selben Tag gleich, an anderen Tagen anders, ca. 50 %", () => {
    const a = pickSubset(specs, "2026-11-14").map((s) => s.symbol);
    expect(pickSubset(specs, "2026-11-14").map((s) => s.symbol)).toEqual(a);
    expect(pickSubset(specs, "2026-11-15").map((s) => s.symbol)).not.toEqual(a);
    expect(a.length).toBeGreaterThan(200);
    expect(a.length).toBeLessThan(300);
    expect(hash01("x")).toBeGreaterThanOrEqual(0);
  });
});
