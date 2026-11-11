import type { Candle } from "../src/lib/types";

/** Deterministischer Zufall (Mulberry32). */
export function rng(seed = 1) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Erzeugt Kerzen, die linear durch die Wegpunkte laufen (`barsPerLeg` Kerzen je Bewegung). */
export function candlesFromWaypoints(points: number[], barsPerLeg = 10, noise = 0.002, seed = 7, volume?: (leg: number) => number): Candle[] {
  const r = rng(seed);
  const out: Candle[] = [];
  let t = 1_700_000_000;
  let prev = points[0];
  for (let leg = 0; leg < points.length - 1; leg++) {
    const a = points[leg];
    const b = points[leg + 1];
    for (let k = 1; k <= barsPerLeg; k++) {
      const close = a + ((b - a) * k) / barsPerLeg;
      const open = prev;
      const wig = Math.abs(close) * noise;
      const high = Math.max(open, close) + wig * r();
      const low = Math.min(open, close) - wig * r();
      out.push({ time: t, open, high, low, close, volume: volume ? volume(leg) : 1000 + 200 * r() });
      t += 3600;
      prev = close;
    }
  }
  return out;
}
