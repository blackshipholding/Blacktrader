// Härtetest – Schritt 1: Blacktraders Signale je Aktie (genau der App-Code, nur Vergangenheit).
// Aufruf: tsx gen.ts <shardIndex> <shardCount>
// Ausgabe je Aktie: out/<SYM>.json mit
//   gr:   grüne/rote Trades (Tag + Woche, Regeln wie im App-Turnier: greenRedTrade, Sektor-Regel, Shorts nur bärisch)
//         jeweils mit src, damit „ein Signal je Wert“ (suppressedBy) für altes und neues Blau getrennt geprüft werden kann
//   oldBlue: blaue Trades wie im App-Turnier (runLongTermEcho: 3 Teile, raus bei Ungültig oder Ziel), ok = Blau-Regel
//   newBlue: blaue Positionen nach den NEUEN Regeln (Plan des Nutzers, 11.11.2026)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { backtestSeries } from "/home/user/Blacktrader/src/lib/trainer/engine";
import { findLongTermZone, runLongTermEcho, type LongTermZone } from "/home/user/Blacktrader/src/lib/analysis/longterm";
import { DEFAULT_PARAMS } from "/home/user/Blacktrader/src/lib/analysis/params";
import { blueTrade, greenRedTrade, makeTechWeakAt } from "/home/user/Blacktrader/src/lib/analysis/tradeRules";
import { regimeIndex } from "/home/user/Blacktrader/src/lib/trainer/tournament";
import type { Candle } from "/home/user/Blacktrader/src/lib/types";

const DIR = "/tmp/claude-0/-home-user-Blacktrader/4a846118-24a7-55aa-85de-daff0330394a/scratchpad/ht";
const OUT = `${DIR}/sig`;
const FROM = Date.UTC(1975, 0, 1) / 1000; // Vorlauf: Analyse ab 1975, Trades zählen im Test ab 1990
mkdirSync(OUT, { recursive: true });

const load = (s: string): Candle[] =>
  (JSON.parse(readFileSync(`${DIR}/data/${s}.json`, "utf8")) as number[][]).map(([time, open, high, low, close, volume]) => ({ time, open, high, low, close, volume }));

/** Wochenkerzen; Zeitstempel = letzter Handelstag der Woche (dann ist die Kerze wirklich fertig – kein Blick voraus) */
function weekly(d: Candle[]): Candle[] {
  const out: Candle[] = [];
  let cur: Candle | null = null;
  let wk = -1;
  for (const c of d) {
    const w = Math.floor((c.time / 86400 + 3) / 7); // Wochen ab Montag
    if (w !== wk) {
      if (cur) out.push(cur);
      cur = { ...c };
      wk = w;
    } else {
      cur!.high = Math.max(cur!.high, c.high);
      cur!.low = Math.min(cur!.low, c.low);
      cur!.close = c.close;
      cur!.time = c.time;
      cur!.volume += c.volume;
    }
  }
  if (cur) out.push(cur);
  return out;
}

// Marktlage (S&P 500) und Sektor-Regel (Tech-Index aus den IT-Werten, gleichgewichtet – kein NASDAQ 100 in den Daten)
const spx = load("_SPX");
const regimeAt = regimeIndex(spx);
const meta = JSON.parse(readFileSync(`${DIR}/data/_meta.json`, "utf8")).meta as Record<string, [string, string, number]>;
const sectors: Record<string, string> = {};
for (const line of readFileSync(`${DIR}/overview.csv`, "utf8").split("\n").slice(1)) {
  const m = line.match(/^([^,]+),(?:"[^"]*"|[^,]*),([^,]*),/);
  if (m) sectors[m[1]] = m[2];
}
const techWeakAt = (() => {
  const f = `${DIR}/data/_TECH.json`;
  if (existsSync(f)) return makeTechWeakAt(load("_TECH"));
  return () => false;
})();

/** Neue Blau-Regeln (Plan des Nutzers): 1. Kauf eine Order an der Oberkante; höchstens 2 Nachkäufe, wenn der Kurs den
 *  letzten Bereich nach oben ODER unten verlassen hat und Blacktrader einen neuen Bereich findet; fällt der Kurs: kein
 *  Stop, kein Verlust-Verkauf; Nachkauf nach oben: Stop für alles auf max(1. Einstieg, Wellenstart des neuen Bereichs);
 *  Verkauf am Top (Ziel des letzten Bereichs) alles auf einmal. */
interface Leg { t: number; px: number }
interface NewPos { legs: Leg[]; exit: { t: number; px: number; why: "ziel" | "stop" } | null; rule: boolean }
function newBlue(w: Candle[]): NewPos[] {
  const out: NewPos[] = [];
  const seen = new Set<string>();
  let order: { z: LongTermZone; from: number; kind: "first" | "up" | "down" } | null = null;
  let pos: (NewPos & { zone: LongTermZone; target: number; stop: number | null; minClose: number }) | null = null;
  for (let i = 150; i < w.length; i++) {
    const c = w[i];
    // 1) Ausführung offener Order (Limit an der Oberkante; liegt der Kurs schon darunter: zum Kurs)
    if (order && i > order.from) {
      const z = order.z;
      if (c.close < z.invalidation || c.high >= z.targets[0]) order = null; // verpasst / ungültig vor dem Kauf
      else if (c.low <= z.zoneTop) {
        const px = Math.min(z.zoneTop, c.open);
        if (!pos) {
          pos = { legs: [{ t: c.time, px }], exit: null, rule: blueTrade({ invalidation: z.invalidation, target: z.targets[0], zoneTop: z.zoneTop }).ok, zone: z, target: z.targets[0], stop: null, minClose: c.close };
        } else {
          pos.legs.push({ t: c.time, px });
          // Nachkauf nach oben: Stop für alles auf Ø Einstieg oder höher (Wellenstart des neuen Bereichs) – nur wenn er
          // unter dem Kurs liegt (flatex). So wird nie mit Verlust verkauft (Regel des Nutzers).
          if (order.kind === "up") {
            const avg = pos.legs.reduce((a, l) => a + l.px, 0) / pos.legs.length;
            const cand = Math.max(avg, z.start.price, pos.stop ?? 0);
            if (cand < c.close * 0.995) pos.stop = cand;
          }
          pos.zone = z;
          // Ziel bleibt das höchste der Position: am Top verkaufen, nie mit Verlust (Regel des Nutzers)
          pos.target = Math.max(pos.target, z.targets[0]);
          pos.minClose = c.close;
        }
        order = null;
      }
    }
    // 2) Ausstieg: Stop (nur nach Nachkauf nach oben) oder Ziel = Top → alles auf einmal
    if (pos) {
      pos.minClose = Math.min(pos.minClose, c.close);
      const filledNow = pos.legs[pos.legs.length - 1].t === c.time;
      if (!filledNow && pos.stop != null && c.low < pos.stop) {
        // Stop-Order wie bei flatex: zum Stop-Kurs, bei Kurslücke darunter zum Eröffnungskurs
        pos.exit = { t: c.time, px: Math.min(pos.stop, c.open), why: "stop" };
      } else if (!filledNow && c.high >= pos.target) {
        pos.exit = { t: c.time, px: Math.max(pos.target, c.open), why: "ziel" };
      }
      if (pos.exit) {
        const { zone, target, stop, minClose, ...p } = pos;
        void zone, target, stop, minClose;
        out.push(p);
        pos = null;
        order = null;
      }
    }
    // 3) Neuer Bereich (nur Daten bis Kerze i)
    const z = findLongTermZone(w.slice(Math.max(0, i + 1 - 600), i + 1));
    if (!z || z.status !== "zulaufend" || seen.has(z.key)) continue;
    seen.add(z.key);
    if (!pos) {
      if (!order) order = { z, from: i, kind: "first" };
      continue;
    }
    if (pos.legs.length >= 3 || order) continue;
    const last = pos.zone;
    const up = z.high.time > pos.legs[pos.legs.length - 1].t && z.high.price > last.zoneTop;
    const down = pos.minClose < last.zoneBottom && z.zoneTop < pos.legs[pos.legs.length - 1].px;
    if (up) order = { z, from: i, kind: "up" };
    else if (down) order = { z, from: i, kind: "down" };
  }
  if (pos) {
    const { zone, target, stop, minClose, ...p } = pos;
    void zone, target, stop, minClose;
    out.push(p); // offen bis zum Datenende
  }
  return out;
}

const [shard, shards] = [Number(process.argv[2] ?? 0), Number(process.argv[3] ?? 1)];
const syms = Object.keys(meta).sort().filter((_, k) => k % shards === shard);
let n = 0;
for (const sym of syms) {
  const f = `${OUT}/${sym}.json`;
  if (existsSync(f)) {
    n++;
    continue;
  }
  const t0 = Date.now();
  const all = load(sym).filter((c) => c.time >= FROM);
  const res: Record<string, unknown> = { sym, sector: sectors[sym] ?? "", gr: [], oldBlue: [], newBlue: [], z1d: [], z1w: [], err: null };
  try {
    const wk = weekly(all);
    const gr: unknown[] = [];
    if (all.length > 300) {
      const r = backtestSeries({ name: sym, kind: "stock", horizon: "medium", interval: "1d", candles: all } as never, DEFAULT_PARAMS, { step: 1 });
      res.z1d = r.zones.map((z) => [z.t, z.at, z.top, z.bottom, z.dir]);
      for (const t of r.trades) {
        if (t.reason === "end") continue;
        const ok = greenRedTrade(t, { symbol: sym, techWeakAt, regimeAt });
        if (ok) gr.push({ src: "1d", e: t.entryTime, x: t.exitTime, r: t.returnPct, px: t.entry, color: ok.color, short: ok.short, risk: ok.riskPct, chance: ok.chancePct });
      }
    }
    if (wk.length > 200) {
      const r = backtestSeries({ name: sym, kind: "stock", horizon: "long", interval: "1w", candles: wk } as never, DEFAULT_PARAMS, { step: 1 });
      res.z1w = r.zones.map((z) => [z.t, z.at, z.top, z.bottom, z.dir]);
      for (const t of r.trades) {
        if (t.reason === "end") continue;
        const ok = greenRedTrade(t, { symbol: sym, techWeakAt, regimeAt });
        if (ok) gr.push({ src: "1w", e: t.entryTime, x: t.exitTime, r: t.returnPct, px: t.entry, color: ok.color, short: ok.short, risk: ok.riskPct, chance: ok.chancePct });
      }
      res.oldBlue = runLongTermEcho(wk, undefined, 1).trades.map((t) => ({ e: t.entryTime, x: t.exitTime, r: t.returnPct, px: t.entry, open: t.result === "offen", ok: blueTrade(t).ok, zt: t.zoneTop, zb: t.zoneBottom, risk: blueTrade(t).riskPct, chance: blueTrade(t).chancePct }));
      res.newBlue = newBlue(wk);
    }
    res.gr = gr;
  } catch (e) {
    res.err = String(e);
  }
  res.sec = (Date.now() - t0) / 1000;
  writeFileSync(f, JSON.stringify(res));
  n++;
  console.log(`[${shard}] ${n}/${syms.length} ${sym} ${res.sec}s${res.err ? " FEHLER " + res.err : ""}`);
}
