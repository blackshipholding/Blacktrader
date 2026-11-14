import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PARAMS } from "../src/lib/analysis/params";

const mem = new Map<string, string>();
const ls = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k), key: (i: number) => [...mem.keys()][i] ?? null, get length() { return mem.size; } };
vi.stubGlobal("window", { localStorage: ls, addEventListener: () => {} });
vi.stubGlobal("localStorage", ls);
vi.mock("../src/lib/client/api", () => ({ api: { fundamentals: async () => ({ fundamentals: null }), news: async () => ({ news: [] }) } }));

function walk(seed: number, n: number, step: number) {
  let x = seed;
  const r = () => ((x = (x * 1664525 + 1013904223) % 4294967296) / 4294967296);
  let p = 100;
  return Array.from({ length: n }, (_, i) => {
    const o = p;
    p *= 1 + (r() - 0.48) * 0.04 + Math.sin(i / 20) * 0.006;
    return { time: 1_400_000_000 + i * step, open: o, high: Math.max(o, p) * (1 + r() * 0.01), low: Math.min(o, p) * (1 - r() * 0.01), close: p, volume: 1e6 };
  });
}

describe("Messung der neuen Variante nach der Suche", () => {
  it("läuft mit denselben Kerzen durch, schreibt nur in die (zurückgesetzte) Live-Bilanz und lässt die alte Liste unberührt", async () => {
    const store = await import("../src/lib/store/store");
    const T = await import("../src/lib/client/trialState");
    const { MARKET_ASSETS } = await import("../src/lib/client/marketList");
    const { afterScan } = await import("../src/lib/client/trial");
    T.startTrial({ "stock:medium": { params: { ...DEFAULT_PARAMS, zoneAtrMult: 4.5 }, baseParams: DEFAULT_PARAMS, base: {} as never, cand: {} as never, changes: "x" } }, "0.2");
    const oldBefore = JSON.stringify(T.getOldLog());
    const items = MARKET_ASSETS.slice(0, 12).map((a, i) => ({ asset: a, full: { medium: walk(10 + i, 900, 86400), long: walk(50 + i, 400, 604800) } }));
    await afterScan(items, { spBull: true, techWeak: false });
    expect(Array.isArray(store.getData().chanceLog)).toBe(true);
    expect(JSON.stringify(T.getOldLog())).toBe(oldBefore);
    for (const e of store.getData().chanceLog) expect(e.zoneTop).toBeGreaterThan(e.zoneBottom);
  }, 60000);
});
