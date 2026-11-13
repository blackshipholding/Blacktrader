import { describe, expect, it, vi } from "vitest";

const mem = new Map<string, string>();
vi.stubGlobal("window", { localStorage: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) }, addEventListener: () => {} });
vi.stubGlobal("localStorage", (globalThis as unknown as { window: { localStorage: Storage } }).window.localStorage);

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

vi.mock("../src/lib/client/api", () => ({
  api: {
    candles: async (a: { symbol: string }, iv: string) => {
      const seed = [...a.symbol].reduce((s, c) => s + c.charCodeAt(0), 7);
      return { candles: walk(seed, iv === "1w" ? 400 : 900, iv === "1w" ? 604800 : 86400), currency: "USD" };
    },
  },
}));
vi.mock("../src/lib/client/worldList", async (orig) => {
  const m = (await orig()) as Record<string, unknown>;
  return { ...m, worldAssets: () => ["AAA", "BBB.DE", "CCC.T", "DDD.SS", "EEE", "FFF.TO", "GGG", "HHH", "III", "JJJ"].map((s) => ({ kind: "stock", symbol: s, name: s, yahooSymbol: s })) };
});
vi.mock("../src/lib/client/scanner", async (orig) => {
  const m = (await orig()) as Record<string, unknown>;
  return { ...m, fetchMarketContext: async () => ({ spBull: true, techWeak: false }) };
});

describe("Welt-Suche läuft durch", () => {
  it("analysiert die Werte, schreibt nur in die eigene Liste, setzt Fortschritt und beendet den Tag", async () => {
    const W = await import("../src/lib/client/worldScan");
    const { getData } = await import("../src/lib/store/store");
    const before = JSON.stringify(getData().chanceLog);
    await W.runWorldScan(true);
    const log = W.getWorldLog();
    expect(Array.isArray(log)).toBe(true);
    for (const e of log) {
      expect(e.zoneTop).toBeGreaterThan(e.zoneBottom);
      expect(e.target).toBeGreaterThan(0);
      expect(["Europa", "USA", "Kanada", "Asien-Pazifik", "Schwellenländer Asien", "Krypto", "Rohstoffe"]).toContain(e.region);
    }
    expect(JSON.stringify(getData().chanceLog)).toBe(before); // normale Live-Bilanz unberührt
    const prog = JSON.parse(mem.get("bt-world-scan-v1")!);
    expect(prog.doneToday).toBe(10);
    expect(prog.cursor).toBe(0); // 10 von 10 Werten: Umlauf einmal komplett, Zeiger wieder am Anfang
    expect(W.worldScanOn()).toBe(false); // Standard aus
    // zweiter Lauf am selben Tag ohne force: nichts mehr
    const n = W.getWorldLog().length;
    await W.runWorldScan(false);
    expect(W.getWorldLog().length).toBe(n);
  }, 60000);
});
