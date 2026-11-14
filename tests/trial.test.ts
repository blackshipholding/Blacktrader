import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PARAMS } from "../src/lib/analysis/params";
import type { Metrics } from "../src/lib/trainer/engine";

const mem = new Map<string, string>();
const ls = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k), key: (i: number) => [...mem.keys()][i] ?? null, get length() { return mem.size; } };
vi.stubGlobal("window", { localStorage: ls, addEventListener: () => {} });
vi.stubGlobal("localStorage", ls);

const m = (r: number): Metrics => ({ trades: 300, hitRate: 0.4, avgWin: 10, avgLoss: -5, profitFactor: 1.5, maxDrawdown: -50, perMonth: 1, zones: 300, zoneRate: r });
const entry = (key: string, result?: "ziel" | "stop") => ({ key, symbol: "X", name: "X", kind: "stock", color: "gruen" as const, dir: "long" as const, zoneTop: 10, zoneBottom: 9, stop: 8, target: 14, from: 1, ...(result ? { entered: 2, result, at: 3 } : {}) });

describe("Versionsnummer", () => {
  it("zählt automatisch weiter und wird auf dem Gerät gemerkt", async () => {
    mem.clear();
    vi.resetModules();
    const V = await import("../src/lib/client/shipVersion");
    expect(V.shipVersion()).toBe("0.2");
    expect(V.nextVersion("0.2")).toBe("0.3");
    expect(V.nextVersion("0.9")).toBe("0.10");
    V.setShipVersion("0.3");
    expect(V.shipLabel()).toBe("Shipmaster 0.3");
  });
});

describe("Varianten-Messung", () => {
  beforeEach(() => {
    mem.clear();
    vi.resetModules();
  });
  const setup = async () => {
    const store = await import("../src/lib/store/store");
    const T = await import("../src/lib/client/trialState");
    return { store, T };
  };
  it("Start: Live-Bilanz auf null, bisherige Variante läuft unsichtbar weiter; Nein bringt sie zurück", async () => {
    const { store, T } = await setup();
    store.actions.setChanceLog([entry("a", "ziel"), entry("b")]);
    T.startTrial({ "stock:medium": { params: { ...DEFAULT_PARAMS, zoneAtrMult: 4.5 }, baseParams: DEFAULT_PARAMS, base: m(0.8), cand: m(0.85), changes: "x" } }, "0.2");
    expect(store.getData().chanceLog).toEqual([]);
    expect(T.getOldLog()).toHaveLength(2);
    expect(T.trialActive()).toBe(true);
    // Kandidat sammelt seine eigenen Ergebnisse in der sichtbaren Liste, die alte in ihrer eigenen
    store.actions.setChanceLog([entry("n1", "ziel")]);
    T.oldStore().set([...T.getOldLog(), entry("c", "stop")]);
    T.endTrial(true);
    expect(T.trialActive()).toBe(false);
    expect(store.getData().chanceLog).toHaveLength(3); // bisherige Variante: ihre Liste inkl. weitergelaufener Ergebnisse
  });
  it("100 Ergebnisse = bereit; Ja beendet ohne Rückgabe der alten Liste und archiviert sie", async () => {
    const { store, T } = await setup();
    T.startTrial({ "stock:medium": { params: DEFAULT_PARAMS, baseParams: DEFAULT_PARAMS, base: m(0.8), cand: m(0.85), changes: "x" } }, "0.2");
    const log = Array.from({ length: 100 }, (_, i) => entry(`k${i}`, i % 2 ? "ziel" : "stop"));
    expect(T.trialReady(T.getTrial(), log.slice(0, 99))).toBe(false);
    expect(T.trialReady(T.getTrial(), log)).toBe(true);
    store.actions.setChanceLog(log);
    T.archiveOldLog("0.2");
    T.endTrial(false);
    expect(store.getData().chanceLog).toHaveLength(100); // neue Variante bleibt in der Live-Bilanz
    expect(T.getArchive()[0].version).toBe("0.2");
    expect(T.getOldLog()).toEqual([]);
  });
  it("Überlagerung fürs Training gilt nur während der Messung", async () => {
    const { T } = await setup();
    const base = {};
    expect(T.overlayParams(base)).toBe(base);
    T.startTrial({ "stock:medium": { params: { ...DEFAULT_PARAMS, zoneAtrMult: 4.5 }, baseParams: DEFAULT_PARAMS, base: m(0.8), cand: m(0.85), changes: "x" } }, "0.2");
    expect(T.overlayParams(base)["stock:medium"]?.zoneAtrMult).toBe(4.5);
    T.endTrial(true);
    expect(T.overlayParams(base)).toBe(base);
  });
  it("Nein verwirft alles, was auf der Variante aufbaute", async () => {
    const { T } = await setup();
    const P = await import("../src/lib/client/proposals");
    const S = await import("../src/lib/client/trainingSession");
    const a = P.addProposal("stock:medium", { baseParams: DEFAULT_PARAMS, deployed: { ...DEFAULT_PARAMS, zoneAtrMult: 4.5 }, base: m(0.8), cand: m(0.85), changes: "x" })!;
    for (const d of ["2026-11-14", "2026-11-15", "2026-11-16", "2026-11-17", "2026-11-18"]) P.recordCheck(a.id, { day: d, pass: true, note: "ok" });
    expect(P.getProposals()[0].status).toBe("ready");
    S.tryStartTrial();
    expect(P.getProposals()[0].status).toBe("trial");
    expect(T.trialActive()).toBe(true);
    expect(await S.decideTrial(false)).toMatch(/bisherige Variante/);
    expect(T.trialActive()).toBe(false);
    expect(P.getProposals().some((p) => p.status === "trial")).toBe(false);
  });
});
