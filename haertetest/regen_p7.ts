// Punkt 7 – saubere Prüfung Tag für Tag: blaue Positionen mit einzelnen Teilen (Kaufzeit/-preis) und reserviertem Geld
// für wartende Teile. A = Shipmaster 0.1 (Teile warten bis Ziel/ungültig). B = Punkt 7: Wochen-Schluss ≥ Oberkante × 1,2 UND
// Blacktraders Wochen-Zählung hat ein bestätigtes Tief ÜBER der Zone nach dem letzten Aufenthalt in der Zone → wartende Teile löschen.
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { findLongTermZone, DEFAULT_LONGTERM } from "/home/user/Blacktrader/src/lib/analysis/longterm";
import { zigzag } from "/home/user/Blacktrader/src/lib/analysis/zigzag";
import type { Candle } from "/home/user/Blacktrader/src/lib/types";
const DIR = "/tmp/claude-0/-home-user-Blacktrader/4a846118-24a7-55aa-85de-daff0330394a/scratchpad/ht";
const FROM = Date.UTC(1975, 0, 1) / 1000;
const load = (s: string): Candle[] => (JSON.parse(readFileSync(`${DIR}/data/${s}.json`, "utf8")) as number[][]).map(([time, open, high, low, close, volume]) => ({ time, open, high, low, close, volume }));
const wkOf = (t: number) => Math.floor((t / 86400 + 3) / 7);
function weekly(d: Candle[]) {
  const out: Candle[] = []; const lastIdx: number[] = []; let cur: Candle | null = null; let wk = -1;
  d.forEach((c, i) => { const w = wkOf(c.time); if (w !== wk) { if (cur) out.push(cur); cur = { ...c }; wk = w; lastIdx.push(i); } else { cur!.high = Math.max(cur!.high, c.high); cur!.low = Math.min(cur!.low, c.low); cur!.close = c.close; cur!.time = c.time; lastIdx[lastIdx.length - 1] = i; } });
  if (cur) out.push(cur); return { w: out, lastIdx };
}
const [shard, shards] = [Number(process.argv[2]), Number(process.argv[3])];
const OUT = process.env.OUT ?? "sigP7";
const files = readdirSync(`${DIR}/sig`).sort().filter((_, k) => k % shards === shard).slice(0, Number(process.env.ONLYN ?? 1e9));
let cancels = 0, lostFills = 0;
for (const f of files) {
  if (existsSync(`${DIR}/${OUT}/${f}`)) continue;
  const d = JSON.parse(readFileSync(`${DIR}/sig/${f}`, "utf8"));
  const res: Record<string, unknown[]> = { A: [], B: [], C: [], D: [], E: [], F: [], G: [], H: [], I: [] };
  if (!d.err) {
    const CUT = Number(process.env.CUT ?? 0);
    const day = load(d.sym).filter((c) => c.time >= FROM && (!CUT || c.time < CUT));
    const { w, lastIdx } = weekly(day);
    const weekAt = new Map<number, number>(); lastIdx.forEach((di, wi) => weekAt.set(di, wi));
    if (w.length > 200) {
      const seen = new Set<string>();
      for (let i = 150; i < w.length; i++) {
        const z = findLongTermZone(w.slice(Math.max(0, i + 1 - 600), i + 1));
        if (!z || z.status !== "zulaufend" || seen.has(z.key)) continue;
        seen.add(z.key);
        for (const ver of ["A", "B", "C", "D", "E", "F", "G", "H", "I"] as const) {
          // H: wie C, aber der Stop zählt erst am WOCHENSCHLUSS unter der Oberkante (Verkauf zum Wochenschluss) – wie „ungültig“
          // C: Stop Oberkante ab +20 % · D: ab +20 % nur wartende Teile löschen · E: Stop 5 % unter Oberkante ab +20 % · F: Stop Oberkante ab +30 %
          const gainV = ver === "F" ? 1.3 : 1.2;
          const stopV = ver === "E" ? z.zoneTop * 0.95 : ver === "G" ? z.zoneTop * 0.98 : z.zoneTop;
          const withStop = ver === "C" || ver === "E" || ver === "F" || ver === "G";
          const fills: { t: number; p: number; k: number }[] = [];
          let exit = NaN, exitT = 0, kind = "offen", cancelT = 0, lastIn = 0, guard = false;
          for (let j = lastIdx[i] + 1; j < day.length; j++) {
            const c = day[j];
            // C = Shipmaster 0.2: Stop auf der Oberkante (ab dem Tag nach dem Auslöser), wartende Teile gelöscht
            if (ver === "I" && guard && c.close <= z.zoneTop) { exit = c.close; exitT = c.time; kind = "stop"; break; }
            if (guard && withStop && c.low <= stopV) { exit = Math.min(stopV, c.open); exitT = c.time; kind = "stop"; break; }
            if (!cancelT) z.tranches.forEach((t, k) => { if (c.low <= t && !fills.some((x) => x.k === k)) fills.push({ t: c.time, p: Math.min(t, c.open), k }); });
            if (c.low <= z.zoneTop) lastIn = c.time;
            const wi = weekAt.get(j);
            if (ver === "H" && guard && wi != null && c.close < z.zoneTop) { exit = c.close; exitT = c.time; kind = "stop"; break; }
            if (wi != null && c.close < z.invalidation) { exit = c.close; exitT = c.time; kind = fills.length ? "inv" : "verpasst"; break; }
            if (c.high >= z.targets[0]) { exit = Math.max(z.targets[0], c.open); exitT = c.time; kind = fills.length ? "ziel" : "verpasst"; break; }
            if ((ver === "C" || ver === "D" || ver === "E" || ver === "F" || ver === "G" || ver === "H" || ver === "I") && !guard && fills.length) { const avg = fills.reduce((s, x) => s + x.p, 0) / fills.length; if (c.close > z.zoneTop && c.close >= avg * gainV) { guard = true; cancelT = c.time; } }
            if (ver === "B" && !cancelT && wi != null && fills.length && fills.length < 3 && c.close >= z.zoneTop * 1.2) {
              const pv = zigzag(w.slice(Math.max(0, wi + 1 - 600), wi + 1), DEFAULT_LONGTERM.atrMult);
              if (pv.some((p) => p.type === "L" && p.confirmed && p.time > lastIn && p.price > z.zoneTop)) cancelT = c.time;
            }
          }
          if (kind === "verpasst" || !fills.length) continue;
          const open = kind === "offen";
          if (open) { exit = day[day.length - 1].close; exitT = day[day.length - 1].time; }
          if (ver === "B" && cancelT) cancels++;
          res[ver].push({ e: fills[0].t, x: exitT, px: exit, open, zt: z.zoneTop, legs: fills.map((x) => [x.t, x.p]), resv: [0, 1, 2].filter((k) => !fills.some((x) => x.k === k)).length, cancel: cancelT || null });
        }
        const a = res.A.at(-1) as { legs: unknown[]; e: number } | undefined, b = res.B.at(-1) as { legs: unknown[]; e: number } | undefined;
        if (a && b && a.e === b.e) lostFills += a.legs.length - b.legs.length;
      }
    }
  }
  writeFileSync(`${DIR}/${OUT}/${f}`, JSON.stringify({ ...d, posA: res.A, posB: res.B, posC: res.C, posD: res.D, posE: res.E, posF: res.F, posG: res.G, posH: res.H, posI: res.I }));
}
console.log("cancels", cancels, "verlorene Teilkäufe", lostFills);
