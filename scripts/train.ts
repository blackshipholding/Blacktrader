// Erst-Training offline auf vorhandenen CSV-Kursreihen (gleiche Regeln wie der nächtliche Trainer).
// Aufruf: DATA_DIR=<ordner> npx tsx scripts/train.ts
// Ergebnis: je Bereich alt gegen neu auf unbekannten Prüfdaten (Walk-Forward), mit allen Strenge-Regeln.
import fs from "node:fs";
import path from "node:path";
import { aggregateCandles } from "../src/lib/data/aggregate";
import { DEFAULT_PARAMS } from "../src/lib/analysis/params";
import type { Universe } from "../src/lib/trainer/job";
import { advanceWF, finalizeWF, initWF } from "../src/lib/trainer/walkforward";
import type { CellKey, SeriesSpec } from "../src/lib/trainer/universe";
import type { Candle } from "../src/lib/types";

const DIR = process.env.DATA_DIR ?? "data";

function readCsv(file: string): Candle[] {
  const lines = fs.readFileSync(path.join(DIR, file), "utf8").trim().split("\n");
  const head = lines[0].toLowerCase().split(",");
  const idx = (k: string) => head.findIndex((h) => h === k);
  const iT = Math.max(0, idx("time"), idx("date"));
  const [iO, iH, iL, iC, iV] = ["open", "high", "low", "close", "volume"].map(idx);
  return lines
    .slice(1)
    .map((l) => {
      const c = l.split(",");
      const raw = c[iT];
      const time = /^\d+$/.test(raw) ? Number(raw) : Math.floor(Date.parse(raw.length <= 10 ? `${raw}T00:00:00Z` : raw.replace(" ", "T") + "Z") / 1000);
      return { time, open: +c[iO], high: +c[iH], low: +c[iL], close: +c[iC], volume: iV >= 0 ? +c[iV] || 0 : 0 };
    })
    .filter((c) => Number.isFinite(c.close) && c.close > 0);
}

// Verfügbare Reihen (Datei, Zusammenfassung in Sekunden)
const SOURCES: Record<string, { file: string | string[]; agg?: number; lastYears?: number }> = {
  "SPY 1d": { file: "SPY_D.csv", lastYears: 20 },
  "GOOG 1d": { file: "GOOG.csv" },
  "SPY 1w": { file: "SPY_D.csv", agg: 7 * 86400, lastYears: 15 },
  "Gold13 1h": { file: "xau2013_5m.csv", agg: 3600 },
  "Gold16-17 1h": { file: ["xau2016_5m.csv", "xau2017_5m.csv"], agg: 3600 },
  "Gold16-17 4h": { file: ["xau2016_5m.csv", "xau2017_5m.csv"], agg: 4 * 3600 },
};
const UNI: Partial<Record<CellKey, SeriesSpec[]>> = {
  "stock:medium": ["SPY 1d", "GOOG 1d"].map((symbol) => ({ symbol, kind: "stock", horizon: "medium", interval: "1d", days: 0, step: 1 })),
  "stock:long": [{ symbol: "SPY 1w", kind: "stock", horizon: "long", interval: "1w", days: 0, step: 1 }],
  "commodity:short": ["Gold13 1h", "Gold16-17 1h"].map((symbol) => ({ symbol, kind: "commodity", horizon: "short", interval: "1h", days: 0, step: 1 })),
};
const uni: Universe = (c) => UNI[c] ?? [];
const cache = new Map<string, Candle[]>();
const load = async (s: SeriesSpec) => {
  if (!cache.has(s.symbol)) {
    const src = SOURCES[s.symbol];
    let c = (Array.isArray(src.file) ? src.file : [src.file]).flatMap(readCsv).sort((a, b) => a.time - b.time);
    if (src.agg) c = aggregateCandles(c, src.agg);
    if (src.lastYears) c = c.filter((x) => x.time >= c[c.length - 1].time - src.lastYears! * 365 * 86400);
    cache.set(s.symbol, c);
  }
  return cache.get(s.symbol)!;
};

async function main() {
  const BUDGET = Number(process.env.BUDGET_S ?? 120) * 1000;
  const pct = (x: number) => `${(x * 100).toFixed(1)} %`;
  const only = process.env.CELL as CellKey | undefined;
  for (const cell of (Object.keys(UNI) as CellKey[]).filter((c) => !only || c === only)) {
    const st = initWF(cell, uni(cell), DEFAULT_PARAMS, { maxSteps: 200, candidatesPerStep: 8 });
    const done = await advanceWF(st, { load, deadline: Date.now() + BUDGET });
    const r = done ? st.result : finalizeWF(st);
    if (!r) {
      console.log(`${cell}: kein Ergebnis`);
      continue;
    }
    const f = (m: typeof r.base) => `${pct(m.hitRate)} | ${m.trades} Signale | PF ${m.profitFactor.toFixed(2)} | Ø+ ${m.avgWin.toFixed(2)} % Ø− ${m.avgLoss.toFixed(2)} % | DD ${m.maxDrawdown.toFixed(1)} % | ${m.perMonth.toFixed(2)}/Monat`;
    console.log(`\n${cell} (${st.step} Lernschritte, ${Object.keys(st.pool).length} geprüfte Einstellungen)`);
    console.log(`  alt (unbekannte Daten): ${f(r.base)}`);
    console.log(`  neu (unbekannte Daten): ${f(r.cand)}`);
    console.log(`  ${r.decision.accept ? "ÜBERNOMMEN" : "verworfen"}: ${r.decision.reasons.join("; ") || "alle Regeln erfüllt"}`);
    console.log(`  Werte (final): ${r.changes}`);
  }
}
void main();
