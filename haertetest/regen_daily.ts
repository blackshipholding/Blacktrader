// Saubere Gegenprobe Shipmaster 0.1 vs 0.2: Zonen wie in der App aus Wochenkerzen (nur Vergangenheit), verfolgt Tag für Tag
// in zeitlicher Reihenfolge: Teil-Käufe (Tagestief ≤ Teil), Ziel (Tageshoch ≥ Ziel), ungültig (Wochen-Schlusskurs < Wellenstart),
// 0.2: ab Tages-Schlusskurs > Oberkante und ≥ +20 % über dem Ø der BIS DAHIN gekauften Teile → Stop auf Oberkante ab nächstem Tag.
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { findLongTermZone } from "/home/user/Blacktrader/src/lib/analysis/longterm";
import { blueTrade } from "/home/user/Blacktrader/src/lib/analysis/tradeRules";
import type { Candle } from "/home/user/Blacktrader/src/lib/types";
const DIR = "/tmp/claude-0/-home-user-Blacktrader/4a846118-24a7-55aa-85de-daff0330394a/scratchpad/ht";
const FROM = Date.UTC(1975, 0, 1) / 1000;
const load = (s: string): Candle[] => (JSON.parse(readFileSync(`${DIR}/data/${s}.json`, "utf8")) as number[][]).map(([time, open, high, low, close, volume]) => ({ time, open, high, low, close, volume }));
const wkOf = (t: number) => Math.floor((t / 86400 + 3) / 7);
function weekly(d: Candle[]): { w: Candle[]; lastIdx: number[] } {
  const out: Candle[] = []; const lastIdx: number[] = []; let cur: Candle | null = null; let wk = -1;
  d.forEach((c, i) => { const w = wkOf(c.time); if (w !== wk) { if (cur) out.push(cur); cur = { ...c }; wk = w; lastIdx.push(i); } else { cur!.high = Math.max(cur!.high, c.high); cur!.low = Math.min(cur!.low, c.low); cur!.close = c.close; cur!.time = c.time; lastIdx[lastIdx.length - 1] = i; } });
  if (cur) out.push(cur); return { w: out, lastIdx };
}
const [shard, shards] = [Number(process.argv[2]), Number(process.argv[3])];
const files = readdirSync(`${DIR}/sig`).sort().filter((_, k) => k % shards === shard);
for (const f of files) {
  if (existsSync(`${DIR}/sigD02/${f}`)) continue;
  const d = JSON.parse(readFileSync(`${DIR}/sig/${f}`, "utf8"));
  const out: Record<string, unknown[]> = { "01": [], "02": [] };
  if (!d.err) {
    const day = load(d.sym).filter((c) => c.time >= FROM);
    const { w, lastIdx } = weekly(day);
    const isWeekEnd = new Set(lastIdx);
    if (w.length > 200) {
      const seen = new Set<string>();
      for (let i = 150; i < w.length; i++) {
        const z = findLongTermZone(w.slice(Math.max(0, i + 1 - 600), i + 1));
        if (!z || z.status !== "zulaufend" || seen.has(z.key)) continue;
        seen.add(z.key);
        for (const ver of ["01", "02"] as const) {
          const fills: { t: number; p: number }[] = [];
          let guarded = false, exit = NaN, exitT = 0, res = "offen", prot = false;
          for (let j = lastIdx[i] + 1; j < day.length; j++) {
            const c = day[j];
            if (guarded && c.low <= z.zoneTop) { exit = Math.min(z.zoneTop, c.open); exitT = c.time; res = "ok"; prot = true; break; }
            if (!guarded) for (const t of z.tranches) if (fills.length < 3 && c.low <= t && !fills.some((x) => x.p === t)) fills.push({ t: c.time, p: Math.min(t, c.open) });
            if (isWeekEnd.has(j) && c.close < z.invalidation) { exit = c.close; exitT = c.time; res = fills.length ? "inv" : "verpasst"; break; }
            if (c.high >= z.targets[0]) { exit = Math.max(z.targets[0], c.open); exitT = c.time; res = fills.length ? "ok" : "verpasst"; break; }
            if (ver === "02" && fills.length && !guarded) { const avg = fills.reduce((s, x) => s + x.p, 0) / fills.length; if (c.close > z.zoneTop && c.close >= avg * 1.2) guarded = true; }
          }
          if (res === "verpasst" || !fills.length) continue;
          const avg = fills.reduce((s, x) => s + x.p, 0) / fills.length;
          const open = res === "offen";
          if (open) { exit = day[day.length - 1].close; exitT = day[day.length - 1].time; }
          const bt = blueTrade({ invalidation: z.invalidation, target: z.targets[0], zoneTop: z.zoneTop });
          out[ver].push({ e: fills[0].t, x: exitT, r: ((exit - avg) / avg) * 100, px: avg, open, ok: bt.ok, zt: z.zoneTop, zb: z.zoneBottom, risk: bt.riskPct, chance: bt.chancePct, prot: prot ? 1 : 0 });
        }
      }
    }
  }
  writeFileSync(`${DIR}/sigD01/${f}`, JSON.stringify({ ...d, oldBlue: out["01"] }));
  writeFileSync(`${DIR}/sigD02/${f}`, JSON.stringify({ ...d, oldBlue: out["02"] }));
}
