// Feste, deterministische Testdaten für den Fingerabdruck-Vergleich (Golden-Test).
import type { Candle } from "../../src/lib/types";
import { candlesFromWaypoints, rng } from "../helpers";

export function randomWalk(seed: number, n: number, start = 100, vol = 0.02, sec = 86400): Candle[] {
  const r = rng(seed);
  const out: Candle[] = [];
  let p = start;
  let drift = 0;
  for (let i = 0; i < n; i++) {
    if (i % 40 === 0) drift = (r() - 0.47) * 0.006;
    const o = p;
    const c = o * (1 + drift + (r() - 0.5) * vol);
    out.push({ time: 1_600_000_000 + i * sec, open: o, high: Math.max(o, c) * (1 + r() * 0.006), low: Math.min(o, c) * (1 - r() * 0.006), close: c, volume: 1000 + r() * 3000 });
    p = c;
  }
  return out;
}

export const FIXTURES: Record<string, Candle[]> = {
  walk1: randomWalk(11, 700),
  walk2: randomWalk(29, 700, 50, 0.03),
  walk3: randomWalk(73, 700, 2000, 0.012),
  waves: candlesFromWaypoints([100, 130, 118, 160, 145, 190, 172, 200, 260, 220, 300, 270, 330, 280, 310, 240, 290], 18, 0.004, 5),
  down: candlesFromWaypoints([300, 260, 280, 220, 240, 180, 200, 150, 170, 120, 140, 100, 130], 20, 0.004, 6),
};
