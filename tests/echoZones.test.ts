import { describe, expect, it } from "vitest";
import { runEcho, summarize } from "../src/lib/analysis/echoZones";
import { candlesFromWaypoints } from "./helpers";

describe("EchoChart-Zonen (wie HKCM gezählt)", () => {
  it("zählt gehaltene und gescheiterte Zonen, getrennt nach Art", async () => {
    const c = candlesFromWaypoints([100, 160, 130, 190, 150, 230, 120, 200, 170, 260, 180, 300], 40, 0.003);
    const r = await runEcho(c, { kind: "stock", horizon: "medium", interval: "1d" });
    const s = summarize(r.zones);
    expect(s.zones).toBe(r.zones.length);
    expect(s.held).toBe(r.zones.filter((z) => z.ok).length);
    expect(s.byKind.trade.zones + s.byKind.short.zones + s.byKind.core.zones).toBe(s.zones);
    for (const z of r.zones) expect(z.at).toBeGreaterThan(z.t);
  }, 60_000);
  it("sieht nicht in die Zukunft: abgeschnittene Kurse ändern frühere Ergebnisse nicht", async () => {
    const c = candlesFromWaypoints([100, 160, 130, 190, 150, 230, 120, 200, 170, 260, 180, 300], 40, 0.003);
    const cut = c[c.length - 60].time;
    const a = (await runEcho(c, { kind: "stock", horizon: "medium", interval: "1d" })).zones.filter((z) => z.at < cut);
    const b = (await runEcho(c.slice(0, -59), { kind: "stock", horizon: "medium", interval: "1d" })).zones.filter((z) => z.at < cut);
    expect(b).toEqual(a);
  }, 60_000);
  it("ohne Zonen keine Quote", () => {
    expect(summarize([]).rate).toBeNull();
  });
});
