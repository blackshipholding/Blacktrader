// Shipmaster 0.2 genau wie in der App: blaue Trades neu mit runLongTermEcho (Gewinn-Schutz an) – Rest der Signale bleibt
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { runLongTermEcho } from "/home/user/Blacktrader/src/lib/analysis/longterm";
import { blueTrade } from "/home/user/Blacktrader/src/lib/analysis/tradeRules";
import type { Candle } from "/home/user/Blacktrader/src/lib/types";
const DIR = "/tmp/claude-0/-home-user-Blacktrader/4a846118-24a7-55aa-85de-daff0330394a/scratchpad/ht";
const FROM = Date.UTC(1975, 0, 1) / 1000;
const load = (s: string): Candle[] => (JSON.parse(readFileSync(`${DIR}/data/${s}.json`, "utf8")) as number[][]).map(([time, open, high, low, close, volume]) => ({ time, open, high, low, close, volume }));
function weekly(d: Candle[]): Candle[] {
  const out: Candle[] = []; let cur: Candle | null = null; let wk = -1;
  for (const c of d) { const w = Math.floor((c.time / 86400 + 3) / 7); if (w !== wk) { if (cur) out.push(cur); cur = { ...c }; wk = w; } else { cur!.high = Math.max(cur!.high, c.high); cur!.low = Math.min(cur!.low, c.low); cur!.close = c.close; cur!.time = c.time; cur!.volume += c.volume; } }
  if (cur) out.push(cur); return out;
}
const [shard, shards] = [Number(process.argv[2]), Number(process.argv[3])];
const files = readdirSync(`${DIR}/sig`).sort().filter((_, k) => k % shards === shard);
for (const f of files) {
  if (existsSync(`${DIR}/sig2/${f}`)) continue;
  const d = JSON.parse(readFileSync(`${DIR}/sig/${f}`, "utf8"));
  if (!d.err) {
    const wk = weekly(load(d.sym).filter((c) => c.time >= FROM));
    if (wk.length > 200) d.oldBlue = runLongTermEcho(wk, undefined, 1).trades.map((t) => ({ e: t.entryTime, x: t.exitTime, r: t.returnPct, px: t.entry, open: t.result === "offen", ok: blueTrade(t).ok, zt: t.zoneTop, zb: t.zoneBottom, risk: blueTrade(t).riskPct, chance: blueTrade(t).chancePct, prot: t.protectedExit ? 1 : 0 }));
  }
  writeFileSync(`${DIR}/sig2/${f}`, JSON.stringify(d));
}
