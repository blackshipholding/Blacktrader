// Turnier rechnen (im Web Worker): Kursdaten laden, Trades aller 16 Teilnehmer erzeugen und 50 Versuche à 5 Jahre
// in echter Zeit durchspielen. Blacktrader spielt in 5 Runden zu je 10 Versuchen; zwischen den Runden lernt er
// (Strenge-Regeln unverändert) und spielt die nächste Runde mit seinem neuesten gespeicherten Stand.
import { runLongTermEcho } from "../analysis/longterm";
import type { LearnableParams } from "../analysis/params";
import type { AssetKind, Candle, Horizon } from "../types";
import { backtestSeries } from "./engine";
import { blueTrade, greenRedTrade, suppressedBy, type ActiveIntervals } from "../analysis/tradeRules";
import { benchmarkRun, makeWindows, regimeIndex, rank, RULES, runWindow, SCENARIOS, summarizeRuns, type ContestantResult, type PoolTrade, type RunResult, type Scenario, type Series, type TournamentReport, type Window } from "./tournament";
import { universe, type CellKey, type SeriesSpec } from "./universe";
import { isUsStock, makeVariants, OPPONENTS, type AnalystEvent, type BotParams, type VariantOrigin } from "./opponents";

export interface TournamentIO {
  load: (spec: SeriesSpec) => Promise<Candle[] | null>;
  onProgress: (fraction: number, text: string) => void;
  shouldStop: () => boolean;
  extra?: { symbol: string; kind: AssetKind; yahooSymbol?: string }[];
  /** Bank-Analysten: Hoch-/Herabstufungen eines Werts (nur US-Aktien) */
  analysts?: (symbol: string) => Promise<AnalystEvent[] | null>;
  /** Dividenden eines Werts (für Dogs of the Dow) */
  dividends?: (symbol: string) => Promise<{ time: number; amount: number }[] | null>;
  /** Champions der Gegner aus dem letzten Turnier (id → Stellschrauben) */
  champions?: Record<string, BotParams>;
  /** Zufallszahl für neue Varianten (jedes Turnier anders) */
  seed?: number;
}

/** Welche Variante ein Gegner gespielt hat (steht in der Auswertung) */
export interface LineupEntry {
  id: string;
  name: string;
  params: BotParams;
  label: string;
  origin: VariantOrigin;
  /** Zahl der geprüften Varianten */
  tried: number;
}

export type Params = (kind: AssetKind, horizon: Horizon) => LearnableParams;

const KINDS: AssetKind[] = ["stock", "crypto", "commodity"];
const DAYS = 15 * 365;
const tick = () => new Promise((r) => setTimeout(r, 0));
const DESC = "Elliott-Wellen + Fundamental/News + Volumen/RSI, ein Einstieg pro Wert (blau/grün/rot), Sektor-Regel";

/** Vergleichsmaßstab: echter, bei flatex handelbarer ETF (Xetra, Euro, thesaurierend → Dividenden im Kurs) */
export const BENCHMARK = { symbol: "SXR8.DE", name: "Vergleich: S&P-500-ETF (iShares Core, SXR8)", desc: "echter ETF in Euro, Dividenden wiederangelegt – alles kaufen, 5 Jahre liegen lassen" };

interface Asset {
  symbol: string;
  kind: AssetKind;
  daily: Candle[];
  weekly: Candle[] | null;
}

export interface Prepared {
  assets: Asset[];
  windows: Window[];
  from: number;
  priceAt: (sym: string, t: number) => number | null;
  techWeakAt: (t: number) => boolean;
  /** Trades in Euro umrechnen (Wechselkurs am Kauf- und Verkaufstag) */
  toEur: (pool: PoolTrade[]) => PoolTrade[];
  /** Marktlage des S&P 500 zum Zeitpunkt t */
  regimeAt: (t: number) => "bullisch" | "neutral" | "baerisch" | null;
  bots: ContestantResult[];
  /** Gespielte Varianten der Gegner */
  lineup: LineupEntry[];
  /** Vergleich: echter S&P-500-ETF (handelt nicht mit) */
  benchmark?: ContestantResult | null;
  note: string;
}

/**
 * Daten laden, Zeiträume festlegen und die 15 Gegner spielen lassen (die lernen nicht von Blacktrader).
 * Jeder Gegner wählt vorher seine beste Variante (Champion gegen neue Varianten) auf EIGENEN Auswahl-Zeiträumen
 * (3 Jahre, andere Startzeitpunkte) – nur nach seinem eigenen Ergebnis, nie gegen Blacktrader.
 */
export async function prepareTournament(io: TournamentIO, span: [number, number] = [0, 1]): Promise<Prepared | null> {
  const P = (f: number, t: string) => io.onProgress(span[0] + (span[1] - span[0]) * f, t);
  const specs = new Map<string, { kind: AssetKind; daily: SeriesSpec; weekly: SeriesSpec }>();
  for (const kind of KINDS) {
    const d = universe(`${kind}:medium` as CellKey);
    const w = universe(`${kind}:long` as CellKey);
    d.forEach((s, i) => specs.set(s.symbol, { kind, daily: { ...s, days: DAYS }, weekly: w[i] ?? { ...s, interval: "1w", days: DAYS } }));
  }
  for (const e of io.extra ?? []) {
    const symbol = e.yahooSymbol ?? (e.kind === "crypto" ? `${e.symbol}-USD` : e.symbol);
    if (specs.has(symbol) || symbol.startsWith("^")) continue;
    specs.set(symbol, { kind: e.kind, daily: { symbol, kind: e.kind, horizon: "medium", interval: "1d", days: DAYS, step: 1 }, weekly: { symbol, kind: e.kind, horizon: "long", interval: "1w", days: DAYS, step: 1 } });
  }
  const idx = (symbol: string): SeriesSpec => ({ symbol, kind: "stock", horizon: "medium", interval: "1d", days: DAYS, step: 1 });
  P(0, "Kursdaten laden: S&P 500, NASDAQ 100 und Euro/Dollar");
  const [spx, ndx, eurusd, etf] = await Promise.all([io.load(idx("^GSPC")), io.load(idx("^NDX")), io.load(idx("EURUSD=X")), io.load(idx(BENCHMARK.symbol))]);
  if (!spx || spx.length < 1600) return null;
  const ndxCl = (ndx ?? []).map((c) => c.close);
  const techWeakAt = (t: number) => {
    if (!ndx?.length) return false;
    let i = ndx.length - 1;
    while (i > 0 && ndx[i].time > t) i--;
    if (i < 200) return false;
    let m = 0;
    for (let k = i - 199; k <= i; k++) m += ndxCl[k];
    return ndxCl[i] < m / 200;
  };
  const assets: Asset[] = [];
  const list = [...specs.entries()];
  for (let k = 0; k < list.length; k++) {
    if (io.shouldStop()) return null;
    const [symbol, s] = list[k];
    P((0.6 * k) / list.length, `Kursdaten laden: ${symbol}`);
    const [daily, weekly] = await Promise.all([io.load(s.daily), io.load(s.weekly)]);
    if (daily && daily.length > 300) assets.push({ symbol, kind: s.kind, daily, weekly });
  }
  // Bank-Analysten (nur US-Aktien) und Dividenden – fehlen sie, handeln die betroffenen Gegner eben nicht
  const extraData = new Map<string, { analysts?: AnalystEvent[]; dividends?: { time: number; amount: number }[] }>();
  const stocks = assets.filter((a) => a.kind === "stock");
  for (let k = 0; k < stocks.length; k++) {
    if (io.shouldStop()) return null;
    const a = stocks[k];
    P(0.6 + (0.1 * k) / stocks.length, `Analysten und Dividenden laden: ${a.symbol}`);
    const [an, dv] = await Promise.all([isUsStock(a.symbol) && io.analysts ? io.analysts(a.symbol) : null, io.dividends ? io.dividends(a.symbol) : null]);
    extraData.set(a.symbol, { analysts: an ?? undefined, dividends: dv ?? undefined });
  }
  if (assets.length < 10) return null;
  const from = spx[200].time;
  const windows = makeWindows(spx, from);
  if (!windows.length) return null;
  const bySym = new Map(assets.map((a) => [a.symbol, a.daily]));
  const closeAt = (c: Candle[] | null | undefined, t: number) => {
    if (!c?.length) return null;
    if (c[0].time > t) return c[0].close;
    let lo = 0;
    let hi = c.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (c[mid].time <= t) lo = mid;
      else hi = mid - 1;
    }
    return c[lo].close;
  };
  // Alles in Euro: Werte außerhalb des Euro-Raums (US-Aktien, Krypto, Rohstoffe) mit dem Euro/Dollar-Kurs des Tages
  const EUR_SUFFIX = [".DE", ".F", ".VI", ".PA", ".AS", ".MI", ".MC", ".BR"];
  const inEur = (sym: string) => EUR_SUFFIX.some((x) => sym.toUpperCase().endsWith(x));
  const eurPer = (sym: string, t: number) => {
    if (inEur(sym)) return 1;
    const r = closeAt(eurusd, t);
    return r && r > 0 ? 1 / r : 1;
  };
  const toEur = (pool: PoolTrade[]): PoolTrade[] =>
    pool.map((p) => ({ ...p, r: ((1 + p.r / 100) * (eurPer(p.sym, p.exit) / eurPer(p.sym, p.entry)) - 1) * 100, px: p.px != null ? p.px * eurPer(p.sym, p.entry) : p.px }));
  const priceAt = (sym: string, t: number) => {
    const c = closeAt(bySym.get(sym), t);
    return c == null ? null : c * eurPer(sym, t);
  };
  const data: Series[] = assets.map((a) => ({ symbol: a.symbol, candles: a.daily, kind: a.kind, ...extraData.get(a.symbol) }));
  const ctx = { spx };
  // Auswahl-Zeiträume: 20 × 3 Jahre, andere Startzeitpunkte als die 50 Turnier-Zeiträume
  const selWindows = makeWindows(spx, from + 45 * 86400, 20, 3);
  const bots: ContestantResult[] = [];
  const lineup: LineupEntry[] = [];
  const seed = io.seed ?? 1;
  for (let k = 0; k < OPPONENTS.length; k++) {
    if (io.shouldStop()) return null;
    const o = OPPONENTS[k];
    const vars = makeVariants(o, io.champions?.[o.id], seed * 101 + k * 7919);
    let best: { v: (typeof vars)[number]; pool: PoolTrade[]; score: number } | null = null;
    for (let n = 0; n < vars.length; n++) {
      P(0.7 + (0.3 * (k + n / vars.length)) / OPPONENTS.length, `${o.name}: Variante ${n + 1}/${vars.length} wird geprüft`);
      await tick();
      if (io.shouldStop()) return null;
      const pool = toEur(o.build(data, vars[n].params, ctx).filter((t) => t.entry >= from));
      const runs = selWindows.map((w) => runWindow(pool, w, priceAt));
      const score = runs.reduce((a, r) => a + (r.end > 0 ? Math.pow(r.end / RULES.start, 1 / 3) - 1 : -1), 0) / Math.max(1, runs.length);
      // Bei Gleichstand bleibt der Champion
      if (!best || score > best.score + 1e-9) best = { v: vars[n], pool, score };
    }
    const label = o.describe(best!.v.params);
    lineup.push({ id: o.id, name: o.name, params: best!.v.params, label, origin: best!.v.origin, tried: vars.length });
    bots.push(summarizeRuns(o.id, o.name, `${o.desc} – Variante: ${label}`, windows.map((w) => ({ w, r: runWindow(best!.pool, w, priceAt) }))));
  }
  // Vergleich nur, wenn der ETF den ganzen Zeitraum abdeckt (Kurs in Euro, Dividenden im Kurs enthalten)
  const benchmark = etf && etf.length > 300 && etf[0].time <= from + 7 * 86400 ? summarizeRuns("etf", BENCHMARK.name, BENCHMARK.desc, windows.map((w) => ({ w, r: benchmarkRun(etf, w) }))) : null;
  const cnt: Partial<Record<Scenario, number>> = {};
  for (const w of windows) cnt[w.scenario] = (cnt[w.scenario] ?? 0) + 1;
  const note = `Alle Beträge in Euro (Wechselkurs am Kauf- und Verkaufstag${eurusd?.length ? "" : " – Euro/Dollar-Kurs nicht erreichbar, ohne Umrechnung"}). ${assets.length} Werte (Aktien, Krypto, Rohstoffe), Daten ab ${new Date(from * 1000).toLocaleDateString("de-DE")}, ${windows.length} Zeiträume à 5 Jahre (${SCENARIOS.filter((s) => cnt[s]).map((s) => `${cnt[s]}× ${s === "baerisch" ? "bärisch" : s}`).join(", ")}). Rohstoffe kurzfristig (Stundenkerzen) sind nicht enthalten. Bank-Analysten: Einstufungen erst ab etwa 2012 und nur für US-Aktien (${[...extraData.values()].filter((x) => x.analysts?.length).length} Werte mit Daten).`;
  return { assets, windows, from, priceAt, techWeakAt, toEur, regimeAt: regimeIndex(spx), bots, lineup, benchmark, note };
}

/** Alle Trades von Blacktrader mit einem Parameter-Stand (grün/rot: Tag + Woche; blau: Langfrist-Bereich). */
export async function blacktraderPool(prep: Prepared, params: Params, io: TournamentIO, span: [number, number], label: string, only?: AssetKind): Promise<PoolTrade[] | null> {
  const out: PoolTrade[] = [];
  const { from, techWeakAt, regimeAt } = prep;
  const assets = only ? prep.assets.filter((a) => a.kind === only) : prep.assets;
  for (let k = 0; k < assets.length; k++) {
    if (io.shouldStop()) return null;
    const a = assets[k];
    io.onProgress(span[0] + ((span[1] - span[0]) * k) / assets.length, `${label}: ${a.symbol}`);
    const active: ActiveIntervals = { blau: [], "1d": [], "1w": [] };
    type T = { direction: string; reason: string; entryTime: number; exitTime: number; returnPct: number; entry: number; stop?: number; target?: number; score?: number };
    const cand: { src: "1d" | "1w"; t: T }[] = [];
    try {
      if (a.daily.length > 300) {
        const r = backtestSeries({ name: a.symbol, kind: a.kind, horizon: "medium", interval: "1d", candles: a.daily }, params(a.kind, "medium"), { step: 1 });
        for (const z of r.zones) active["1d"].push([z.t, z.at]);
        for (const t of r.trades) cand.push({ src: "1d", t });
      }
      if (a.weekly && a.weekly.length > 200) {
        const r = backtestSeries({ name: a.symbol, kind: a.kind, horizon: "long", interval: "1w", candles: a.weekly }, params(a.kind, "long"), { step: 1 });
        for (const z of r.zones) active["1w"].push([z.t, z.at]);
        for (const t of r.trades) cand.push({ src: "1w", t });
        for (const t of runLongTermEcho(a.weekly, undefined, 1).trades) {
          active.blau.push([t.entryTime, t.exitTime]);
          if (t.result === "offen" || t.entryTime < from) continue;
          const { riskPct, chancePct, ok } = blueTrade(t);
          out.push({ sym: a.symbol, entry: t.entryTime, exit: t.exitTime, r: t.returnPct, px: t.entry, color: "blau", riskPct, chancePct, ...(ok ? {} : { blueRuleOut: true }) });
        }
      }
      for (const { src, t } of cand) {
        if (t.reason === "end" || t.entryTime < from) continue;
        // Ein Signal wie in den Chancen: wichtigeres Signal beim selben Wert aktiv → dieses nicht handeln
        if (suppressedBy(a.kind, src, t.entryTime, active)) continue;
        // Regeln wie in Chancen und EchoChart (analysis/tradeRules.ts)
        const ok = greenRedTrade(t, { symbol: a.symbol, techWeakAt, regimeAt });
        if (!ok) continue;
        out.push({ sym: a.symbol, entry: t.entryTime, exit: t.exitTime, r: t.returnPct, px: t.entry, ...ok });
      }
    } catch {
      /* Wert überspringen */
    }
    await tick();
  }
  return prep.toEur(out);
}

/** Versuche einer Runde (Runde b spielt die Zeiträume b, b+5, b+10, … – so ist jede Runde gemischt). */
export const roundWindows = (prep: Prepared, round: number) => prep.windows.map((w, i) => ({ w, i })).filter((x) => x.i % RULES.rounds === round);

/** Die Trades, die Blacktrader wirklich macht (ohne die von der Blau-Regel ausgeschlossenen) */
export const activePool = (pool: PoolTrade[]) => pool.filter((t) => !t.blueRuleOut);

export function playRound(prep: Prepared, pool: PoolTrade[], round: number): { w: Window; r: RunResult }[] {
  const active = activePool(pool);
  return roundWindows(prep, round).map(({ w }) => ({ w, r: runWindow(active, w, prep.priceAt) }));
}

export function buildReport(prep: Prepared, btRuns: { w: Window; r: RunResult }[], rounds: TournamentReport["rounds"], finalPool: PoolTrade[], improvedCells: TournamentReport["improvedCells"]): TournamentReport {
  const bt = summarizeRuns("blacktrader", "Blacktrader", DESC, btRuns);
  const ranking = rank([bt, ...prep.bots.map((b) => ({ ...b, rankByScenario: {} }))]);
  const active = activePool(finalPool);
  const only = (c: "blau" | "gruen" | "rot") => {
    const p = active.filter((t) => t.color === c);
    return p.length ? summarizeRuns(`bt-${c}`, `Blacktrader nur ${c === "blau" ? "Blau" : c === "gruen" ? "Grün" : "Rot"}`, "", prep.windows.map((w) => ({ w, r: runWindow(p, w, prep.priceAt) }))) : null;
  };
  const scenarioCount: Partial<Record<Scenario, number>> = {};
  for (const w of prep.windows) scenarioCount[w.scenario] = (scenarioCount[w.scenario] ?? 0) + 1;
  return { v: 2, at: new Date().toISOString(), rules: { ...RULES }, ranking, scenarioCount, rounds, split: { blau: only("blau"), gruen: only("gruen"), rot: only("rot") }, benchmark: prep.benchmark ?? null, blueRule: blueRuleCheck(prep, finalPool), improvedCells, opponents: prep.lineup, note: prep.note };
}

/** Kontrolle: derselbe Stand mit und ohne Blau-Regel über alle Zeiträume – zeigt, ob die Regel noch hilft. */
function blueRuleCheck(prep: Prepared, pool: PoolTrade[]): { on: number; off: number } | null {
  if (!pool.some((t) => t.blueRuleOut)) return null;
  const all = pool.map((t) => (t.blueRuleOut ? { ...t, blueRuleOut: undefined } : t));
  const avg = (p: PoolTrade[]) => summarizeRuns("x", "", "", prep.windows.map((w) => ({ w, r: runWindow(p, w, prep.priceAt) }))).avgPerYear;
  return { on: avg(activePool(pool)), off: avg(all) };
}

/**
 * Regelwerk B7 – Turnier-Prüfung: Ein neuer Lern-Stand für einen Bereich (z. B. Aktien mittelfristig) wird nur
 * übernommen, wenn Blacktrader mit ihm in allen 50 Turnier-Zeiträumen (nur Werte dieser Klasse, gleiche Regeln:
 * 8.000 €, 500 € je Trade, Gebühren, KESt) im Schnitt NICHT schlechter abschneidet und NIE ausscheidet
 * (schied schon der bisherige Stand aus, dann jedenfalls nicht öfter). Rückgabe: Grund für ein Nein, sonst null.
 */
export async function b7Check(prep: Prepared, kind: AssetKind, base: Params, cand: Params, io: TournamentIO, basePool?: PoolTrade[] | null): Promise<{ veto: string | null; basePool: PoolTrade[] | null; base: number; cand: number } | null> {
  const span: [number, number] = [0, 1];
  const bp = basePool ?? (await blacktraderPool(prep, base, io, span, "Prüfung B7: bisheriger Stand", kind));
  if (!bp) return null;
  const cp = await blacktraderPool(prep, cand, io, span, "Prüfung B7: neuer Stand", kind);
  if (!cp) return null;
  const sum = (pool: PoolTrade[]) => summarizeRuns("x", "", "", prep.windows.map((w) => ({ w, r: runWindow(activePool(pool), w, prep.priceAt) })));
  const b = sum(bp);
  const c = sum(cp);
  const pc = (x: number) => `${(x * 100).toFixed(1).replace(".", ",")} %`;
  let veto: string | null = null;
  if (c.broke > 0 && (b.broke === 0 || c.broke > b.broke)) veto = `im Turnier ${c.broke}× ausgeschieden`;
  else if (c.avgPerYear < b.avgPerYear - 1e-9) veto = `im Turnier schlechter (${pc(c.avgPerYear)} statt ${pc(b.avgPerYear)} pro Jahr)`;
  return { veto, basePool: bp, base: b.avgPerYear, cand: c.avgPerYear };
}
