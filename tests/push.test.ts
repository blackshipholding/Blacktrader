import { describe, expect, it } from "vitest";
import { findLongTermZone } from "../src/lib/analysis/longterm";
import { evaluatePush } from "../src/lib/push/evaluate";
import type { PushRecord } from "../src/lib/push/types";
import type { Candle } from "../src/lib/types";
import { candlesFromWaypoints } from "./helpers";

const zoneCandles = candlesFromWaypoints([200, 150, 170, 100, 125, 80, 160, 140], 30, 0.002);
const z = findLongTermZone(zoneCandles)!;
const rec = (o: Partial<PushRecord> = {}): PushRecord => ({ sub: { endpoint: "https://x", keys: { p256dh: "a", auth: "b" } }, trades: [], watch: [], ltInterval: "1w", sent: ["primed"], updatedAt: "", ...o });
const flat = (price: number, n = 200): Candle[] => Array.from({ length: n }, (_, i) => ({ time: 1e9 + i * 86400, open: price, high: price * 1.001, low: price * 0.999, close: price, volume: 1 }));

describe("Push-Nachrichten", () => {
  it("Trade: Stop erreicht → genau eine Nachricht", async () => {
    const t = { id: "t1", symbol: "X", name: "X AG", kind: "stock" as const, interval: "1d" as const, direction: "long" as const, status: "open" as const, entry: 100, stop: 95, targets: [110] };
    const r = await evaluatePush(rec({ trades: [t] }), async () => flat(94));
    expect(r.messages.map((m) => m.key)).toEqual(["stop:t1:95"]);
    const again = await evaluatePush(rec({ trades: [t], sent: ["primed", "stop:t1:95"] }), async () => flat(94));
    expect(again.messages).toHaveLength(0);
  });

  it("Langfristig: Teil gekauft, wenn der Kurs den Bereich erreicht", async () => {
    const t = { id: "l1", symbol: "Y", name: "Y AG", kind: "stock" as const, interval: "1w" as const, direction: "long" as const, status: "pending" as const, strategy: "longterm" as const, entry: z.zoneTop, stop: 0, targets: z.targets, tranches: z.tranches.map((p) => ({ price: p })), lt: { zoneTop: z.zoneTop, zoneBottom: z.zoneBottom, invalidation: z.invalidation, targets: z.targets, key: z.key }, remaining: 1 };
    const r = await evaluatePush(rec({ trades: [t] }), async () => [...zoneCandles, ...flat((z.tranches[0] + z.tranches[1]) / 2, 3).map((c, i) => ({ ...c, time: zoneCandles[zoneCandles.length - 1].time + (i + 1) * 86400 }))]);
    expect(r.messages.some((m) => m.key === "fill:l1:0")).toBe(true);
    expect(r.messages.some((m) => m.key === "fill:l1:2")).toBe(false);
  });

  it("Watchlist: erste Prüfung meldet nichts (keine Flut), danach nur neue Bereiche", async () => {
    const w = { symbol: "Z", name: "Z AG", kind: "stock" as const };
    const first = await evaluatePush(rec({ watch: [w], sent: [] }), async () => zoneCandles);
    expect(first.messages).toHaveLength(0);
    expect(first.silent).toContain("primed");
    const second = await evaluatePush(rec({ watch: [w], sent: [...first.silent] }), async () => zoneCandles);
    expect(second.messages).toHaveLength(0); // Bereich schon bekannt
    const fresh = await evaluatePush(rec({ watch: [w], sent: ["primed"] }), async () => zoneCandles);
    expect(fresh.messages[0].title).toMatch(/Einstiegsbereich/);
  });

  it("Fehler beim Laden bricht die Prüfung nicht ab", async () => {
    const t = { id: "t2", symbol: "A", name: "A", kind: "stock" as const, interval: "1d" as const, direction: "long" as const, status: "open" as const, entry: 100, stop: 95, targets: [110] };
    const r = await evaluatePush(rec({ trades: [t, { ...t, id: "t3", symbol: "B" }] }), async (a) => (a.symbol === "A" ? Promise.reject(new Error("x")) : flat(111)));
    expect(r.messages.map((m) => m.key)).toEqual(["t1:t3"]);
  });
});
