import { describe, expect, it } from "vitest";
import { analyzeElliott, expectationFor } from "../src/lib/analysis/elliott";
import { fibFit, nearestFib, retracementLevels } from "../src/lib/analysis/elliott/fib";
import { evalComplex, evalDiagonal, evalFlat, evalImpulse, evalTriangle, evalZigzag } from "../src/lib/analysis/elliott/patterns";
import { pivotsFromPrices, zigzag } from "../src/lib/analysis/zigzag";
import { candlesFromWaypoints } from "./helpers";

const P = (xs: number[]) => pivotsFromPrices(xs);

describe("Fibonacci", () => {
  it("bewertet Verhältnisse", () => {
    expect(fibFit(0.618, [0.618])).toBe(1);
    expect(fibFit(0.5, [0.618])).toBe(0);
    expect(fibFit(1.6, [1.618])).toBeGreaterThan(0.8);
    expect(nearestFib(0.6)).toBe(0.618);
    expect(retracementLevels(100, 200, [0.5])[0].price).toBe(150);
  });
});

describe("Impuls – harte Regeln", () => {
  // Lehrbuch-Impuls: W1 100→120, W2 →108 (0.6), W3 →140 (1.6×), W4 →128 (0.375), W5 →148 (1.0×)
  const ideal = [100, 120, 108, 140, 128, 148];

  it("akzeptiert einen regelkonformen Impuls und erkennt Extension in Welle 3", () => {
    const ev = evalImpulse(P(ideal))!;
    expect(ev).not.toBeNull();
    expect(ev.direction).toBe(1);
    expect(ev.rules.every((r) => r.passed)).toBe(true);
    expect(ev.fib).toBeGreaterThan(0.6);
  });

  it("Welle 2 darf nie unter den Start von Welle 1 fallen", () => {
    expect(evalImpulse(P([100, 120, 98, 140, 128, 148]))).toBeNull();
  });

  it("Welle 3 darf nie die kürzeste sein", () => {
    // W1 = 20, W3 = 12, W5 = 25
    expect(evalImpulse(P([100, 120, 110, 122, 116, 141]))).toBeNull();
  });

  it("Welle 4 darf nicht in den Bereich von Welle 1 laufen", () => {
    expect(evalImpulse(P([100, 120, 108, 140, 118, 150]))).toBeNull();
  });

  it("funktioniert spiegelbildlich für Abwärtsimpulse", () => {
    const down = ideal.map((x) => 300 - x);
    const ev = evalImpulse(P(down))!;
    expect(ev.direction).toBe(-1);
    expect(evalImpulse(P([200, 180, 202, 160, 172, 150]))).toBeNull();
  });

  it("erkennt Extension in Welle 3", () => {
    const ev = evalImpulse(P([100, 110, 105, 140, 133, 143]))!;
    expect(ev.extension).toBe(3);
  });

  it("bewertet Teilimpulse (Welle 1-2) und leitet Welle-3-Ziele ab", () => {
    const pv = P([100, 120, 108]);
    const ev = evalImpulse(pv)!;
    expect(ev.labels).toEqual(["1", "2"]);
    const exp = expectationFor(ev, pv, 2);
    expect(exp.bias).toBe(1);
    expect(exp.stop).toBe(100);
    expect(exp.targets.map((t) => Math.round(t.price))).toEqual([128, 140, 160]);
  });
});

describe("Diagonalen", () => {
  it("erkennt kontrahierende Diagonale mit Überlappung W4/W1", () => {
    const pv = P([100, 120, 108, 124, 114, 122]);
    expect(evalImpulse(pv)).toBeNull(); // Überlappung → kein Impuls
    const ev = evalDiagonal(pv, "ending-diagonal")!;
    expect(ev).not.toBeNull();
    expect(ev.pattern).toBe("ending-diagonal");
  });
  it("lehnt ab, wenn keine Überlappung vorliegt", () => {
    expect(evalDiagonal(P([100, 120, 108, 140, 128, 148]), "leading-diagonal")).toBeNull();
  });
});

describe("Korrekturen", () => {
  it("Zigzag: B < 100 %, C jenseits von A", () => {
    const ev = evalZigzag(P([150, 130, 140, 110]))!;
    expect(ev.pattern).toBe("zigzag");
    expect(ev.direction).toBe(-1);
    expect(evalZigzag(P([150, 130, 152, 120]))).toBeNull();
    expect(evalZigzag(P([150, 130, 140, 132]))).toBeNull();
  });
  it("Flat-Varianten", () => {
    expect(evalFlat(P([150, 130, 149, 129])!)?.pattern).toBe("flat-regular");
    expect(evalFlat(P([150, 130, 155, 122]))?.pattern).toBe("flat-expanded");
    expect(evalFlat(P([150, 130, 156, 138]))?.pattern).toBe("flat-running");
    expect(evalFlat(P([150, 130, 140, 120]))).toBeNull();
  });
  it("Dreiecke", () => {
    expect(evalTriangle(P([100, 80, 95, 84, 92, 87]))?.pattern).toBe("triangle-contracting");
    expect(evalTriangle(P([100, 95, 102, 90, 106, 84]))?.pattern).toBe("triangle-expanding");
    expect(evalTriangle(P([100, 80, 95, 70, 92, 87]))).toBeNull();
  });
  it("Double Zigzag und Kombination", () => {
    // W: 200→180→190→170, X: →180, Y: 180→165→172→150
    const dz = evalComplex(P([200, 180, 190, 170, 180, 165, 172, 150]))!;
    expect(dz.pattern).toBe("double-zigzag");
    expect(dz.labels).toEqual(["a", "b", "W", "X", "a", "b", "Y"]);
    // W als Flat: 200→180→199→179, X →188, Y Zigzag 188→175→182→165
    const cb = evalComplex(P([200, 180, 199, 179, 188, 175, 182, 165]))!;
    expect(cb.pattern).toBe("combination-wxy");
    // Triple Zigzag
    const tz = evalComplex(P([200, 180, 190, 170, 180, 165, 172, 150, 160, 145, 152, 130]))!;
    expect(tz.pattern).toBe("triple-zigzag");
  });
});

describe("ZigZag-Pivots", () => {
  it("findet die Wegpunkte einer klaren Bewegung", () => {
    const c = candlesFromWaypoints([100, 120, 108, 140, 128, 148], 12, 0.001);
    const pv = zigzag(c, 2);
    const prices = pv.map((p) => Math.round(p.price));
    expect(prices.length).toBeGreaterThanOrEqual(5);
    expect(prices).toContain(140);
    expect(prices).toContain(128);
    for (let i = 1; i < pv.length; i++) expect(pv[i].type).not.toBe(pv[i - 1].type);
  });
});

describe("Zählung auf Kerzen", () => {
  it("findet nach Wellen 1-2 die Welle-3-Erwartung (bullisch)", () => {
    // Vorher Abwärtstrend, dann Welle 1 und 2 (61,8 %)
    const c = candlesFromWaypoints([150, 130, 138, 100, 124, 109.2, 111], 12, 0.001);
    const res = analyzeElliott(c);
    expect(res.best).toBeDefined();
    expect(res.counts.length).toBeGreaterThan(0);
    expect(res.counts.some((x) => x.pattern === "impulse" && x.labels.length === 2 && x.bias === 1)).toBe(true);
    for (const cnt of res.counts) for (const r of cnt.rules) if (r.hard) expect(r.passed).toBe(true);
  });

  it("erkennt nach vollständigem Impuls eine bärische Erwartung", () => {
    const c = candlesFromWaypoints([110, 100, 120, 108, 140, 128, 148, 146], 12, 0.001);
    const res = analyzeElliott(c);
    expect(res.counts.some((x) => x.pattern === "impulse" && x.complete && x.bias === -1)).toBe(true);
  });

  it("Score liegt immer zwischen 0 und 100", () => {
    for (let s = 1; s < 6; s++) {
      const c = candlesFromWaypoints([100, 110, 95, 125, 105, 130, 90, 115], 10, 0.01, s);
      const r = analyzeElliott(c);
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
    }
  });

  it("verwirft Zählungen, deren Invalidierung schon unterschritten ist", () => {
    const c = candlesFromWaypoints([150, 100, 124, 109, 95], 12, 0.001);
    const res = analyzeElliott(c);
    for (const cnt of res.counts) expect((95 - cnt.stop) * cnt.bias).toBeGreaterThan(0);
  });
});
