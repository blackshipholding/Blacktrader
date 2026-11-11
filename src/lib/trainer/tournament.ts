// Turnier: Blacktrader gegen 15 Gegner (5 Bots, 5 Bank-Analysten, 5 bekannte Strategien; insgesamt 16 Teilnehmer) – fair und ohne Blick in die Zukunft.
//
// Jeder Teilnehmer erzeugt aus DENSELBEN Kursdaten (alle Werte: Aktien, Krypto, Rohstoffe, 15 Jahre) seine Trades (die Bots nur Käufe, Blacktrader auch Shorts).
// Jedes Signal kennt nur Kerzen bis zu seinem Tag; Einstieg und Ausstieg zum Eröffnungskurs der nächsten Kerze.
//
// Ein Versuch = 5 Jahre ECHTE Zeit: 8.000 € Startkapital (wie das Depot-Konto), 500 € je Trade (nur wenn genug Geld da ist, je Wert höchstens
// eine Position), 7,90 € Gebühr je Order (flatex; Kauf und Verkauf je einmal), 27,5 % KESt (Österreich) SOFORT bei jedem Verkauf mit Gewinn
// (100 € → 110 €: 2,75 € KESt). Ein Verlust im selben Kalenderjahr holt bereits bezahlte KESt anteilig zurück
// (automatischer Verlustausgleich der Bank), ins nächste Jahr wird nichts übertragen.
// Offene Positionen werden am Ende zum Tageskurs bewertet, verkauft und versteuert.
// Wer kein Geld mehr für einen Trade hat und keine offene Position hält, scheidet aus.
// 50 Versuche mit verschiedenen Startzeitpunkten – für alle Teilnehmer dieselben. Jeder Zeitraum wird nach der
// Marktlage (S&P 500) als bullisch, neutral, bärisch oder gemischt eingeordnet. Gewertet wird der Durchschnitt.
import { KestYear } from "../analysis/kest";
import { sma } from "../analysis/indicators";
import type { Candle } from "../types";

export type Regime = "bullisch" | "neutral" | "baerisch";
export type Scenario = Regime | "gemischt";
export const SCENARIOS: Scenario[] = ["bullisch", "neutral", "baerisch", "gemischt"];
export const SCENARIO_LABEL: Record<Scenario, string> = { bullisch: "Bullisch", neutral: "Neutral", baerisch: "Bärisch", gemischt: "Gemischt" };

export interface PoolTrade {
  sym: string;
  entry: number;
  exit: number;
  /** Rendite in % (vor Gebühren) */
  r: number;
  /** Einstiegskurs (für die Bewertung offener Positionen am Ende) */
  px?: number;
  /** Nur Blacktrader: blauer, grüner oder roter (Short) Einstieg */
  color?: "blau" | "gruen" | "rot";
  /** Short: Gewinn bei fallenden Kursen */
  short?: boolean;
  /** Abstand Einstieg–Stop bzw. Einstieg–Ziel in % (nur Blacktrader, für die Chancen-Regeln) */
  riskPct?: number;
  chancePct?: number;
  /** Nur Blacktrader: von der Blau-Regel ausgeschlossen (wird nur zur Kontrolle „ohne Blau-Regel“ gespielt) */
  blueRuleOut?: boolean;
}

export type { BotSeries as Series } from "./opponents";

/** fee: Gebühr je Order in € (flatex 7,90 €); KESt in Österreich auf den Gewinn ohne Abzug der Spesen */
/** addMax/addStake: Nachkauf nur bei Blau, höchstens 4× zu je 250 € (getestet: weniger Risiko, Klumpenrisiko begrenzt) */
export const RULES = { start: 8000, years: 5, reps: 50, stake: 500, fee: 7.9, tax: 0.275, rounds: 5, addMax: 4, addStake: 250 } as const;

// ---------------------------------------------------------------------------------------------
// Marktlage aus dem S&P 500 (nur Vergangenheit)

export function regimeIndex(spx: Candle[]) {
  const closes = spx.map((c) => c.close);
  const s = sma(closes, 200);
  const times = spx.map((c) => c.time);
  return (t: number): Regime | null => {
    let lo = 0;
    let hi = times.length - 1;
    if (!times.length || t < times[0]) return null;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (times[mid] <= t) lo = mid;
      else hi = mid - 1;
    }
    const i = lo;
    const m = s[i];
    if (m == null || i < 100) return null;
    const r = closes[i] / closes[i - 100] - 1;
    return closes[i] > m && r > 0.05 ? "bullisch" : closes[i] < m && r < -0.05 ? "baerisch" : "neutral";
  };
}

// Die 15 Gegner stehen in ./opponents.ts

// ---------------------------------------------------------------------------------------------
// Ein Versuch: 5 Jahre echte Zeit

export interface Window {
  from: number;
  to: number;
  scenario: Scenario;
}

export interface RunResult {
  end: number;
  /** Gewinn nach Gebühren und KESt */
  profit: number;
  tax: number;
  /** bezahlte Gebühren */
  fees?: number;
  trades: number;
  wins: number;
  low: number;
  /** ausgeschieden (kein Geld mehr) */
  broke: boolean;
}

const YEAR = 365.25 * 86400;
const yearOf = (t: number) => new Date(t * 1000).getUTCFullYear();

/**
 * Spielt die Trades eines Teilnehmers im Zeitraum chronologisch durch.
 * `priceAt(sym, t)` liefert den letzten Schlusskurs bis t (für offene Positionen am Ende).
 */
export function runWindow(pool: PoolTrade[], w: Window, priceAt: (sym: string, t: number) => number | null): RunResult {
  type Ev = { t: number; kind: 0 | 1; i: number };
  const trades = pool.filter((p) => p.entry >= w.from && p.entry < w.to);
  const ev: Ev[] = [];
  trades.forEach((p, i) => {
    ev.push({ t: p.entry, kind: 1, i });
    if (p.exit <= w.to) ev.push({ t: p.exit, kind: 0, i });
  });
  // Ausstiege vor Einstiegen am selben Tag; sonst nach Zeit und Wert (eindeutig, für alle gleich)
  ev.sort((a, b) => a.t - b.t || a.kind - b.kind || trades[a.i].sym.localeCompare(trades[b.i].sym));
  let cash: number = RULES.start;
  const open = new Map<number, number>(); // Trade-Index → Einsatz
  const perSym = new Map<string, number>(); // offene Positionen je Wert (1 + Nachkäufe)
  const kest = new KestYear(RULES.tax);
  let tax = 0;
  let fees = 0;
  let taken = 0;
  let wins = 0;
  let low: number = cash;
  let broke = false;
  const close = (i: number, r: number, t: number) => {
    const stake = open.get(i)!;
    // KESt auf den Kursgewinn – Spesen sind in Österreich steuerlich nicht abzugsfähig
    const g = (stake * r) / 100;
    cash += stake + g - RULES.fee;
    fees += RULES.fee;
    if (g - 2 * RULES.fee > 0) wins++;
    // sofort bei Gewinn, Verlusttopf im Kalenderjahr (analysis/kest.ts)
    const k = kest.settle(g, yearOf(t));
    cash -= k;
    tax += k;
    open.delete(i);
    perSym.set(trades[i].sym, (perSym.get(trades[i].sym) ?? 1) - 1);
  };
  for (const e of ev) {
    if (e.kind === 0) {
      if (open.has(e.i)) close(e.i, trades[e.i].r, e.t);
    } else if (!broke) {
      const p = trades[e.i];
      // Je Wert eine Position; Nachkauf nur bei Blau (höchstens addMax × addStake)
      const have = perSym.get(p.sym) ?? 0;
      if (have > 0 && (p.color !== "blau" || have > RULES.addMax)) continue;
      const stake = have > 0 ? RULES.addStake : RULES.stake;
      if (cash < stake + RULES.fee) {
        // ohne Geld und ohne offene Position: ausgeschieden
        if (open.size === 0) broke = true;
        continue;
      }
      cash -= stake + RULES.fee;
      fees += RULES.fee;
      open.set(e.i, stake);
      perSym.set(p.sym, have + 1);
      taken++;
    }
    let eq = cash;
    for (const v of open.values()) eq += v;
    low = Math.min(low, eq);
  }
  // Ende: offene Positionen zum Tageskurs bewerten, verkaufen und versteuern
  for (const i of [...open.keys()]) {
    const p = trades[i];
    const now = priceAt(p.sym, w.to);
    close(i, now && p.px ? (p.short ? (1 - now / p.px) * 100 : (now / p.px - 1) * 100) : 0, w.to);
  }
  if (cash < RULES.stake + RULES.fee) broke = true;
  return { end: cash, profit: cash - RULES.start, tax, fees, trades: taken, wins, low: Math.min(low, cash), broke };
}

/**
 * Vergleichsmaßstab (handelt nicht mit): ein echter, kaufbarer ETF (iShares Core S&P 500, thesaurierend, in Euro).
 * Am Anfang des Zeitraums alles hinein, am Ende verkaufen – gleiche Gebühr und KESt wie bei allen.
 * Die laufende Besteuerung thesaurierender Fonds in Österreich (ausschüttungsgleiche Erträge) ist nicht abgebildet.
 */
export function benchmarkRun(etf: Candle[], w: Window): RunResult {
  const at = (t: number) => {
    let lo = 0;
    let hi = etf.length - 1;
    while (lo < hi) {
      const m = (lo + hi + 1) >> 1;
      if (etf[m].time <= t) lo = m;
      else hi = m - 1;
    }
    return etf[lo].close;
  };
  const a = at(w.from);
  const b = at(w.to);
  const inv = RULES.start - RULES.fee;
  const g = inv * (b / a - 1);
  const tax = Math.max(0, g) * RULES.tax;
  const end = inv + g - RULES.fee - tax;
  return { end, profit: end - RULES.start, tax, fees: 2 * RULES.fee, trades: 1, wins: g > 2 * RULES.fee ? 1 : 0, low: Math.min(RULES.start, end), broke: false };
}

/** 50 Zeiträume à 5 Jahre (gleichmäßig verteilte Startzeitpunkte) mit ihrer Marktlage. */
export function makeWindows(spx: Candle[], from: number, reps: number = RULES.reps, years: number = RULES.years): Window[] {
  const last = spx[spx.length - 1].time;
  const lastStart = last - years * YEAR;
  if (lastStart <= from) return [];
  const regimeOf = regimeIndex(spx);
  const out: Window[] = [];
  for (let k = 0; k < reps; k++) {
    const a = from + ((lastStart - from) * k) / Math.max(1, reps - 1);
    const b = a + years * YEAR;
    const cnt = { bullisch: 0, neutral: 0, baerisch: 0 };
    let n = 0;
    for (const c of spx) {
      if (c.time < a || c.time > b) continue;
      const g = regimeOf(c.time);
      if (g) (cnt[g]++, n++);
    }
    const sh = (g: Regime) => (n ? cnt[g] / n : 0);
    // Bärenmärkte dauern nur Monate (2015/16, 2018, 2020, 2022): ab 15 % Bärentagen zählt ein 5-Jahres-Zeitraum als
    // bärisch (er enthält dann einen Crash bzw. Bärenmarkt), ab 55 % Bullentagen als bullisch, unter 45 % als neutral.
    const scenario: Scenario = sh("baerisch") >= 0.15 ? "baerisch" : sh("bullisch") >= 0.55 ? "bullisch" : sh("bullisch") < 0.45 ? "neutral" : "gemischt";
    out.push({ from: Math.round(a), to: Math.round(b), scenario });
  }
  return out;
}

const mean = (x: number[]) => (x.length ? x.reduce((a, b) => a + b, 0) / x.length : 0);
export const cagr = (end: number) => (end > 0 ? Math.pow(end / RULES.start, 1 / RULES.years) - 1 : -1);

export interface ContestantResult {
  id: string;
  name: string;
  desc: string;
  /** Versuche */
  runs: number;
  /** Durchschnitt der Versuche */
  avgEnd: number;
  avgProfit: number;
  avgTax: number;
  /** Ø bezahlte Gebühren */
  avgFees?: number;
  avgTrades: number;
  /** Ø Rendite pro Jahr (nach Gebühren und KESt) */
  avgPerYear: number;
  /** schlechtester / bester Versuch (Rendite pro Jahr) */
  worstPerYear: number;
  bestPerYear: number;
  winRate: number;
  /** ausgeschieden (kein Geld mehr) in so vielen Versuchen */
  broke: number;
  byScenario: Partial<Record<Scenario, { n: number; avgPerYear: number }>>;
  rankByScenario: Partial<Record<Scenario, number>>;
  rank: number;
}

/** Fasst die Versuche eines Teilnehmers zusammen. */
export function summarizeRuns(id: string, name: string, desc: string, runs: { w: Window; r: RunResult }[]): ContestantResult {
  const py = runs.map((x) => cagr(x.r.end));
  const byScenario: ContestantResult["byScenario"] = {};
  for (const s of SCENARIOS) {
    const xs = runs.filter((x) => x.w.scenario === s);
    if (xs.length) byScenario[s] = { n: xs.length, avgPerYear: mean(xs.map((x) => cagr(x.r.end))) };
  }
  const trades = runs.reduce((a, x) => a + x.r.trades, 0);
  const wins = runs.reduce((a, x) => a + x.r.wins, 0);
  return {
    id,
    name,
    desc,
    runs: runs.length,
    avgEnd: mean(runs.map((x) => x.r.end)),
    avgProfit: mean(runs.map((x) => x.r.profit)),
    avgTax: mean(runs.map((x) => x.r.tax)),
    avgFees: mean(runs.map((x) => x.r.fees ?? 0)),
    avgTrades: mean(runs.map((x) => x.r.trades)),
    avgPerYear: mean(py),
    worstPerYear: py.length ? Math.min(...py) : 0,
    bestPerYear: py.length ? Math.max(...py) : 0,
    winRate: trades ? wins / trades : 0,
    broke: runs.filter((x) => x.r.broke).length,
    byScenario,
    rankByScenario: {},
    rank: 0,
  };
}

/** Rangliste nach Ø Rendite pro Jahr; je Szenario ebenso. */
export function rank(list: ContestantResult[]): ContestantResult[] {
  const out = [...list].sort((a, b) => b.avgPerYear - a.avgPerYear);
  out.forEach((c, i) => (c.rank = i + 1));
  for (const s of SCENARIOS)
    out
      .filter((c) => c.byScenario[s])
      .sort((a, b) => b.byScenario[s]!.avgPerYear - a.byScenario[s]!.avgPerYear)
      .forEach((c, i) => (c.rankByScenario[s] = i + 1));
  return out;
}

export interface TournamentReport {
  /** Version des Berichts (2 = 5-Jahres-Versuche) */
  v: 2;
  at: string;
  rules: typeof RULES;
  ranking: ContestantResult[];
  /** Zeiträume je Szenario */
  scenarioCount: Partial<Record<Scenario, number>>;
  /** Blacktrader je Runde (er lernt zwischen den Runden) */
  rounds?: { round: number; avgPerYear: number; changed: boolean }[];
  /** Blacktrader getrennt: nur blaue, nur grüne bzw. nur rote Einstiege (mit dem Endstand) */
  split?: { blau: ContestantResult | null; gruen: ContestantResult | null; rot?: ContestantResult | null };
  /** Vergleich (handelt nicht mit, nicht in der Rangliste): echter S&P-500-ETF, alles kaufen und liegen lassen */
  benchmark?: ContestantResult | null;
  /** Kontrolle der Blau-Regel: Blacktrader mit und ohne Regel (Ø pro Jahr) */
  blueRule?: { on: number; off: number } | null;
  /** Bereiche, die das Lernen verbessert hat (Zonen-Quote alt → neu) */
  improvedCells?: { cell: string; old: number | null; neu: number | null }[];
  /** Gespielte Varianten der Gegner (Champion bleibt fürs nächste Turnier) */
  opponents?: { id: string; name: string; params: Record<string, number>; label: string; origin: "champion" | "start" | "neu"; tried: number }[];
  /** Regelwerk B7: Prüfung eines neuen Lern-Stands im Turnier */
  b7?: { checked: number; rejected: number; notes: string[] };
  note?: string;
}

// ---------------------------------------------------------------------------------------------
// Auswertung in Worten

export const pct1 = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1).replace(".", ",")} %`;
export const eur0 = (x: number) => `${x < 0 ? "−" : ""}${Math.round(Math.abs(x)).toLocaleString("de-DE")} €`;

/** Ein Punkt der Auswertung: Bezeichnung, kurzer Wert, Details; tone für die Farbe */
export interface ReportItem {
  label: string;
  value: string;
  text?: string;
  tone?: "good" | "warn" | "bad";
}

const pa = (x: number) => `Ø ${pct1(x)} p. a.`;

export function reportItems(rep: TournamentReport, previous?: TournamentReport | null): ReportItem[] {
  const bt = rep.ranking.find((c) => c.id === "blacktrader");
  if (!bt) return [];
  const out: ReportItem[] = [];
  out.push({ label: "Platzierung", value: `Platz ${bt.rank} von ${rep.ranking.length}`, text: `${pa(bt.avgPerYear)} · Ø ${Math.round(bt.avgTrades)} Trades in 5 Jahren · Ø Gewinn nach KESt ${eur0(bt.avgProfit)} · KESt Ø ${eur0(bt.avgTax)}`, tone: bt.rank === 1 ? "good" : undefined });
  const top = rep.ranking[0];
  if (top.id !== "blacktrader") out.push({ label: "Bester", value: top.name, text: pa(top.avgPerYear) });
  const best = SCENARIOS.filter((s) => bt.rankByScenario[s] === 1).map((s) => SCENARIO_LABEL[s]);
  if (best.length) out.push({ label: "Platz 1 in", value: best.join(", ") });
  if (rep.benchmark) {
    const d = bt.avgPerYear - rep.benchmark.avgPerYear;
    const name = rep.benchmark.name.replace(/^Vergleich:\s*/, "");
    out.push({ label: "Vergleich ETF", value: `${name}: ${pa(rep.benchmark.avgPerYear)}`, text: `Blacktrader liegt ${Math.abs(d) < 0.0005 ? "gleichauf" : d > 0 ? `${pct1(d).replace("+", "")} p. a. vorne` : `${pct1(-d).replace("+", "")} p. a. dahinter`}`, tone: d >= 0 ? "good" : "warn" });
  }
  if (rep.blueRule) {
    const { on, off } = rep.blueRule;
    out.push(
      off - on >= 0.005
        ? { label: "Blau-Regel", value: "Achtung", text: `ohne sie wäre Blacktrader besser (${pct1(off)} statt ${pct1(on)} p. a.) – prüfen, ob sie wieder entfernt werden soll`, tone: "warn" }
        : { label: "Blau-Regel", value: "bleibt", text: `mit ${pct1(on)}, ohne ${pct1(off)} p. a. – sie bleibt` },
    );
  }
  if (bt.broke) out.push({ label: "Ausgeschieden", value: `${bt.broke} von ${bt.runs} Versuchen`, text: "kein Geld mehr", tone: "bad" });
  if (rep.rounds && rep.rounds.length > 1) {
    const a = rep.rounds[0];
    const z = rep.rounds[rep.rounds.length - 1];
    const changed = rep.rounds.filter((r) => r.changed).length;
    out.push(changed ? { label: "Lernen im Turnier", value: `Runde 1 ${pct1(a.avgPerYear)} → Runde ${z.round} ${pct1(z.avgPerYear)}`, text: `${changed}× neuer Stand gespeichert`, tone: "good" } : { label: "Lernen im Turnier", value: "kein besserer Stand", text: "alter Stand bleibt" });
  }
  if (rep.split) {
    const parts = (["blau", "gruen", "rot"] as const)
      .map((k) => (rep.split![k] ? `${k === "blau" ? "Blau" : k === "gruen" ? "Grün" : "Rot (Short)"} ${pa(rep.split![k]!.avgPerYear)} (${Math.round(rep.split![k]!.avgTrades)} Trades)` : null))
      .filter(Boolean);
    if (parts.length) out.push({ label: "Getrennt", value: parts.join(" · ") });
  }
  if (rep.opponents?.length) {
    const kept = rep.opponents.filter((o) => o.origin === "champion").length;
    const fresh = rep.opponents.filter((o) => o.origin === "neu").length;
    out.push({ label: "Gegner-Varianten", value: `${kept} Champions · ${fresh} neue Varianten`, text: "ausgewählt auf eigenen Zeiträumen, nicht gegen Blacktrader" });
  }
  if (rep.b7?.checked) out.push({ label: "Regelwerk B7", value: `${rep.b7.checked} geprüft · ${rep.b7.rejected} abgelehnt`, text: "neue Lern-Stände im Turnier (schlechter oder ausgeschieden = abgelehnt)" });
  // Nur vergleichen, wenn die Regeln gleich sind (z. B. nicht 5.000 € gegen 8.000 € Startkapital)
  if (previous && previous.rules?.start === rep.rules.start && previous.rules?.fee === rep.rules.fee) {
    const pb = previous.ranking.find((c) => c.id === "blacktrader");
    if (pb) out.push({ label: "Letzte Auswertung", value: `Platz ${pb.rank} → ${bt.rank}`, text: `${pct1(pb.avgPerYear)} → ${pct1(bt.avgPerYear)} p. a.` });
  }
  return out;
}

/** Auswertung als Sätze (z. B. für Tests und Texte) */
export function reportLines(rep: TournamentReport, previous?: TournamentReport | null): string[] {
  return reportItems(rep, previous).map((i) => `${i.label}: ${i.value}${i.text ? ` – ${i.text}` : ""}`);
}
