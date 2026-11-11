import { describe, expect, it } from "vitest";
import { analyzeElliott } from "../src/lib/analysis/elliott";
import { LOCKED } from "../src/lib/analysis/locked-config";
import { assessLongTerm, blendedReturn, findLongTermZone, runLongTermEcho } from "../src/lib/analysis/longterm";
import type { Candle } from "../src/lib/types";
import { candlesFromWaypoints } from "./helpers";

// Großer Abwärtstrend, Boden, kräftiger Anstieg (Welle 1), dann Rücksetzer
const base = candlesFromWaypoints([200, 150, 170, 100, 125, 80, 160, 140], 30, 0.002);

describe("Langfristiger Einstieg (blau)", () => {
  it("findet den Bereich 61,8–88,6 % der Aufwärtswelle mit Invalidierung am Wellenstart", () => {
    const z = findLongTermZone(base)!;
    expect(z).toBeTruthy();
    const move = z.high.price - z.start.price;
    expect(z.zoneTop).toBeCloseTo(z.high.price - 0.618 * move, 6);
    expect(z.zoneBottom).toBeCloseTo(z.high.price - 0.886 * move, 6);
    expect(z.invalidation).toBe(z.start.price);
    expect(z.tranches).toHaveLength(LOCKED.longterm.tranches);
    expect(z.tranches[0]).toBeGreaterThan(z.tranches[1]);
    expect(z.tranches[1]).toBeGreaterThan(z.tranches[2]);
    expect(z.targets[0]).toBe(z.high.price);
    expect(z.status).toBe("zulaufend");
  });

  it("Status: im Bereich und ungültig", () => {
    const into = candlesFromWaypoints([200, 150, 170, 100, 125, 80, 160, 100], 30, 0.002);
    expect(findLongTermZone(into)?.status).toBe("in-zone");
    const broken = candlesFromWaypoints([200, 150, 170, 100, 125, 80, 160, 70], 30, 0.002);
    const b = findLongTermZone(broken);
    expect(b == null || b.status === "invalidiert").toBe(true);
  });

  it("kein Bereich ohne bullische Struktur (reiner Abwärtstrend)", () => {
    const down = candlesFromWaypoints([200, 180, 190, 160, 170, 140, 150, 120, 128], 30, 0.002);
    expect(findLongTermZone(down)).toBeNull();
  });

  it("Vergangenheits-Messung sieht nicht in die Zukunft", () => {
    const c = candlesFromWaypoints([200, 150, 170, 100, 125, 80, 160, 100, 220, 180, 260], 30, 0.002);
    const full = runLongTermEcho(c, undefined, 3);
    // Kurse nach dem Ende abschneiden darf frühere, abgeschlossene Ergebnisse nicht ändern
    const cut = runLongTermEcho(c.slice(0, -1), undefined, 3);
    expect(full.zones).toBeGreaterThan(0);
    const done = (e: typeof full) => e.trades.filter((t) => t.result !== "offen" && t.exitTime < c[c.length - 2].time);
    expect(done(cut)).toEqual(done(full));
  });
});

describe("Begleitung: Meldungen nur bei geänderter Zählung", () => {
  const pos = (o = {}) => ({ direction: "long" as const, entry: 105, invalidation: 80, remaining: 1, ...o });

  it("Schlusskurs unter dem Wellenstart → komplett aussteigen (einmal)", () => {
    const c = candlesFromWaypoints([200, 150, 170, 100, 125, 80, 160, 100, 75], 30, 0.002);
    const a = assessLongTerm(pos(), c, analyzeElliott(c));
    expect(a?.kind).toBe("ausstieg");
    expect(assessLongTerm(pos({ lastActionKey: a!.key }), c, analyzeElliott(c))).toBeNull();
  });

  it("intakte Zählung → keine Meldung, kein Stop", () => {
    const c = candlesFromWaypoints([200, 150, 170, 100, 125, 80, 160, 105, 120], 30, 0.002);
    const e = analyzeElliott(c);
    // Hauptzählung erwartet steigende Kurse → nichts tun
    const fake = { ...e, best: e.best ? { ...e.best, bias: 1 as const, complete: false } : undefined };
    expect(assessLongTerm(pos(), c, fake)).toBeNull();
  });

  it("Alternativszenario wahrscheinlicher → im Gewinn Hälfte verkaufen und Stop auf Einstieg", () => {
    const c = candlesFromWaypoints([200, 150, 170, 100, 125, 80, 160, 105, 150], 30, 0.002);
    const e = analyzeElliott(c);
    const best = { ...(e.best ?? e.counts[0]), bias: -1 as const, probability: 0.7, direction: -1 as const, complete: false, pattern: "zigzag" as const, patternLabel: "Zickzack" };
    const a = assessLongTerm(pos({ entry: 105 }), c, { ...e, best, counts: [best], contested: false });
    expect(a?.kind).toBe("teilausstieg");
    if (a?.kind === "teilausstieg") {
      expect(a.fraction).toBe(0.5);
      expect(a.stop).toBeGreaterThanOrEqual(105);
    }
  });

  it("Rendite mit Teilausstieg", () => {
    expect(blendedReturn(100, [{ fraction: 0.5, price: 120 }], 110)).toBeCloseTo(15);
    expect(blendedReturn(100, [], 90)).toBeCloseTo(-10);
  });
});

describe("Kernposition entfernt", () => {
  it("gibt es nicht mehr in den festen Werten", () => {
    expect((LOCKED as Record<string, unknown>).core).toBeUndefined();
    expect(LOCKED.signalKinds.longterm).toBe("blau");
  });
});

export type { Candle };
