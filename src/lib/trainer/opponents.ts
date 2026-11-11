// Die 15 Gegner im Turnier: 5 Bots, 5 Bank-Analysten, 5 bekannte Strategien.
//
// Jeder Gegner hat faire Stellschrauben (Bereiche aus der veröffentlichten Methode). Vor jedem Turnier spielt sein
// bisheriger Champion gegen neue Zufalls-Varianten – auf EIGENEN Auswahl-Zeiträumen (3 Jahre, andere Startzeitpunkte),
// gewertet wird nur das eigene Ergebnis (nie gegen Blacktrader abgestimmt). Der Sieger spielt das Turnier.
// Alle handeln nach denselben Regeln wie Blacktrader (8.000 €, 500 € je Trade, 7,90 € Gebühr, KESt, pleite = raus).
// Jedes Signal kennt nur Daten bis zu seinem Tag; Einstieg und Ausstieg zum Eröffnungskurs.
import { rsi, sma } from "../analysis/indicators";
import type { AssetKind, Candle } from "../types";
import type { PoolTrade } from "./tournament";

/** Hoch-/Herabstufung eines Bank-Analysten (Yahoo, meist ab 2012, vor allem US-Aktien) */
export interface AnalystEvent {
  time: number;
  firm: string;
  toGrade: string;
  fromGrade: string;
  /** up, down, main, init, reit */
  action: string;
}

export interface BotSeries {
  symbol: string;
  candles: Candle[];
  kind?: AssetKind;
  dividends?: { time: number; amount: number }[];
  analysts?: AnalystEvent[];
}

export type BotParams = Record<string, number>;
export interface ParamDef {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
}
export interface BotCtx {
  /** S&P 500 (für Dual Momentum: absolutes Momentum des Marktes) */
  spx?: Candle[] | null;
}
export type OpponentGroup = "bot" | "bank" | "strategie";

export interface Opponent {
  id: string;
  name: string;
  group: OpponentGroup;
  desc: string;
  /** Herkunft der Methode (Anzeige) */
  source?: string;
  space: ParamDef[];
  defaults: BotParams;
  /** Variante in Worten */
  describe: (p: BotParams) => string;
  build: (data: BotSeries[], p: BotParams, ctx?: BotCtx) => PoolTrade[];
  /** Rechenaufwand groß → weniger Varianten */
  heavy?: boolean;
}

export const GROUP_LABEL: Record<OpponentGroup, string> = { bot: "Bots", bank: "Bank-Analysten", strategie: "Bekannte Strategien" };

// ---------------------------------------------------------------------------------------------
// Hilfen

const DAY = 86400;
const dayOf = (t: number) => Math.floor(t / DAY);

export const trade = (sym: string, c: Candle[], i: number, j: number): PoolTrade | null =>
  i >= 0 && j < c.length && i < j && c[i].open > 0 ? { sym, entry: c[i].time, exit: c[j].time, r: (c[j].open / c[i].open - 1) * 100, px: c[i].open } : null;

/** Kleiner, reproduzierbarer Zufallsgenerator */
export function rng(seed: number) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}

/** Erste Kerze mit Zeit ≥ t (−1: keine) */
function atOrAfter(c: Candle[], t: number): number {
  let lo = 0;
  let hi = c.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (c[mid].time < t) lo = mid + 1;
    else hi = mid;
  }
  return lo < c.length ? lo : -1;
}

/** Erste Kerze an einem SPÄTEREN Kalendertag als t (Meldung am Tag t → Kauf am nächsten Handelstag zur Eröffnung) */
function nextDay(c: Candle[], t: number): number {
  return atOrAfter(c, (dayOf(t) + 1) * DAY);
}

const monthStart = (y: number, m: number) => Date.UTC(y, m, 1) / 1000;
const yearOf = (t: number) => new Date(t * 1000).getUTCFullYear();

/** Alle Monatsanfänge im Zeitraum der Daten */
function months(data: BotSeries[]): { y: number; m: number; t: number }[] {
  let t0 = Infinity;
  let t1 = -Infinity;
  for (const d of data) if (d.candles.length) (t0 = Math.min(t0, d.candles[0].time), t1 = Math.max(t1, d.candles[d.candles.length - 1].time));
  const out: { y: number; m: number; t: number }[] = [];
  if (!isFinite(t0)) return out;
  for (let y = yearOf(t0); y <= yearOf(t1); y++) for (let m = 0; m < 12; m++) {
    const t = monthStart(y, m);
    if (t >= t0 && t <= t1) out.push({ y, m, t });
  }
  return out;
}

const isStock = (d: BotSeries) => (d.kind ? d.kind === "stock" : true) && !d.symbol.startsWith("^");
/** US-Aktie (Analysten-Daten gibt es fast nur dafür) */
export const isUsStock = (symbol: string) => /^[A-Z][A-Z.-]{0,5}$/.test(symbol) && !symbol.includes(".") && !symbol.endsWith("-USD");

// ---------------------------------------------------------------------------------------------
// 1) Die 5 Bots

function zufall(data: BotSeries[], p: BotParams): PoolTrade[] {
  const r = rng(p.seed);
  const out: PoolTrade[] = [];
  const usable = data.filter((d) => d.candles.length > 250);
  const hold = p.hold;
  for (let k = 0; k < 3000 && usable.length; k++) {
    const d = usable[Math.floor(r() * usable.length)];
    const i = 201 + Math.floor(r() * (d.candles.length - hold - 203));
    const t = trade(d.symbol, d.candles, i, i + hold);
    if (t) out.push(t);
  }
  return out;
}

function kaufenHalten(data: BotSeries[], p: BotParams): PoolTrade[] {
  const out: PoolTrade[] = [];
  for (const { symbol, candles: c } of data) for (let i = 201; i + p.hold < c.length; i += p.every) {
    const t = trade(symbol, c, i, i + p.hold);
    if (t) out.push(t);
  }
  return out;
}

function trendfolger(data: BotSeries[], p: BotParams): PoolTrade[] {
  const out: PoolTrade[] = [];
  for (const { symbol, candles: c } of data) {
    const cl = c.map((x) => x.close);
    const m = sma(cl, p.sma);
    let inAt = -1;
    for (let i = p.sma + 1; i < c.length - 1; i++) {
      if (m[i] == null || m[i - 1] == null) continue;
      if (inAt < 0 && cl[i] > m[i]! && cl[i - 1] <= m[i - 1]!) inAt = i + 1;
      else if (inAt >= 0 && cl[i] < m[i]!) {
        const t = trade(symbol, c, inAt, i + 1);
        if (t) out.push(t);
        inAt = -1;
      }
    }
  }
  return out;
}

function ausbruch(data: BotSeries[], p: BotParams): PoolTrade[] {
  const out: PoolTrade[] = [];
  const nIn = p.entry;
  const nOut = Math.min(p.exit, p.entry);
  for (const { symbol, candles: c } of data) {
    let inAt = -1;
    for (let i = nIn + 1; i < c.length - 1; i++) {
      let hi = -Infinity;
      for (let k = i - nIn; k < i; k++) hi = Math.max(hi, c[k].high);
      let lo = Infinity;
      for (let k = i - nOut; k < i; k++) lo = Math.min(lo, c[k].low);
      if (inAt < 0 && c[i].close > hi) inAt = i + 1;
      else if (inAt >= 0 && c[i].close < lo) {
        const t = trade(symbol, c, inAt, i + 1);
        if (t) out.push(t);
        inAt = -1;
      }
    }
  }
  return out;
}

/** KI-Bot: logistische Regression, lernt je Kalenderjahr NUR mit Fällen, deren Ergebnis vor Jahresbeginn feststand. */
function kiBot(data: BotSeries[], p: BotParams): PoolTrade[] {
  const H = p.hold;
  type Row = { sym: string; c: Candle[]; i: number; f: number[]; y: number; known: number };
  const rows: Row[] = [];
  for (const { symbol, candles: c } of data) {
    const cl = c.map((x) => x.close);
    const r = rsi(cl);
    const m = sma(cl, 200);
    for (let i = 200; i < c.length - H - 1; i++) {
      if (m[i] == null || r[i] == null) continue;
      const lr: number[] = [];
      for (let k = i - 19; k <= i; k++) lr.push(Math.log(cl[k] / cl[k - 1]));
      const mean = lr.reduce((a, b) => a + b, 0) / lr.length;
      const vol = Math.sqrt(lr.reduce((a, b) => a + (b - mean) ** 2, 0) / lr.length);
      rows.push({ sym: symbol, c, i, f: [cl[i] / cl[i - 5] - 1, cl[i] / cl[i - 20] - 1, cl[i] / cl[i - 60] - 1, r[i]! / 100, cl[i] / m[i]! - 1, vol], y: c[i + H + 1].open > c[i + 1].open ? 1 : 0, known: c[i + H + 1].time });
    }
  }
  if (rows.length < 2000) return [];
  let t0 = Infinity;
  let t1 = -Infinity;
  for (const x of rows) {
    const t = x.c[x.i].time;
    if (t < t0) t0 = t;
    if (t > t1) t1 = t;
  }
  const out: PoolTrade[] = [];
  for (let Y = yearOf(t0); Y <= yearOf(t1); Y++) {
    const y0 = Date.UTC(Y, 0, 1) / 1000;
    const y1 = Date.UTC(Y + 1, 0, 1) / 1000;
    const all = rows.filter((x) => x.known < y0);
    // Rechenzeit (Handy): höchstens ~30.000 Lernfälle, gleichmäßig verteilt
    const stride = Math.max(1, Math.ceil(all.length / 30000));
    const tr = stride > 1 ? all.filter((_, n) => n % stride === 0) : all;
    const te = rows.filter((x) => x.c[x.i].time >= y0 && x.c[x.i].time < y1);
    if (tr.length < 1000 || !te.length) continue;
    const d = tr[0].f.length;
    const mu = Array(d).fill(0);
    const sd = Array(d).fill(0);
    for (const x of tr) x.f.forEach((v, k) => (mu[k] += v / tr.length));
    for (const x of tr) x.f.forEach((v, k) => (sd[k] += (v - mu[k]) ** 2 / tr.length));
    for (let k = 0; k < d; k++) sd[k] = Math.sqrt(sd[k]) + 1e-9;
    const X = tr.map((x) => x.f.map((v, k) => (v - mu[k]) / sd[k]));
    const w = Array(d).fill(0);
    let b = 0;
    for (let it = 0; it < 200; it++) {
      const g = Array(d).fill(0);
      let gb = 0;
      for (let n = 0; n < X.length; n++) {
        let z = b;
        for (let k = 0; k < d; k++) z += X[n][k] * w[k];
        const e = 1 / (1 + Math.exp(-z)) - tr[n].y;
        for (let k = 0; k < d; k++) g[k] += e * X[n][k];
        gb += e;
      }
      for (let k = 0; k < d; k++) w[k] -= (0.1 * g[k]) / X.length;
      b -= (0.1 * gb) / X.length;
    }
    const busy = new Map<string, number>();
    for (const x of te) {
      let z = b;
      x.f.forEach((v, k) => (z += ((v - mu[k]) / sd[k]) * w[k]));
      if (1 / (1 + Math.exp(-z)) > p.thr && x.c[x.i].time >= (busy.get(x.sym) ?? 0)) {
        const t = trade(x.sym, x.c, x.i + 1, x.i + H + 1);
        if (t) {
          out.push(t);
          busy.set(x.sym, t.exit);
        }
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// 2) Die 5 Bank-Analysten (Hoch-/Herabstufungen, Daten ab etwa 2012, nur US-Aktien)

/** Kaufempfehlung? (Buy, Outperform, Overweight, Strong Buy, Positive, Accumulate …) */
export const isBuyGrade = (g: string) => /buy|outperform|overweight|positive|accumulate|top pick|conviction/i.test(g) && !/under|sell|reduce/i.test(g);

type Signal = { t: number; buy: boolean; sell: boolean };

/** Gemeinsamer Ablauf: Kaufsignal → Kauf am nächsten Handelstag; Verkauf nach `hold` Tagen oder (wenn eingestellt) beim Abstufen. */
function fromSignals(symbol: string, c: Candle[], sig: Signal[], hold: number, sellOnDown: boolean): PoolTrade[] {
  const out: PoolTrade[] = [];
  let i = -1;
  let j = -1;
  const close = () => {
    const t = trade(symbol, c, i, j);
    if (t) out.push(t);
    i = -1;
  };
  for (const s of sig) {
    if (i >= 0 && j < c.length && c[j].time <= s.t) close();
    if (i < 0 && s.buy) {
      const k = nextDay(c, s.t);
      if (k < 0) break;
      i = k;
      j = k + hold;
    } else if (i >= 0 && s.sell && sellOnDown) {
      const k = nextDay(c, s.t);
      if (k < 0) break;
      if (k < j) j = Math.max(k, i + 1);
      close();
    }
  }
  if (i >= 0 && j < c.length) close();
  return out;
}

function bankBot(firm: RegExp) {
  return (data: BotSeries[], p: BotParams): PoolTrade[] => {
    const out: PoolTrade[] = [];
    for (const d of data) {
      if (!d.analysts?.length || !isStock(d)) continue;
      const sig: Signal[] = d.analysts
        .filter((a) => firm.test(a.firm))
        .map((a) => {
          const pos = isBuyGrade(a.toGrade);
          const fresh = a.action === "up" || a.action === "init" || (p.reit === 1 && (a.action === "reit" || a.action === "main"));
          return { t: a.time, buy: pos && fresh, sell: !pos && (a.action === "down" || a.action === "init" || a.action === "main" || a.action === "reit") };
        });
      out.push(...fromSignals(d.symbol, d.candles, sig, p.hold, p.sellOnDown === 1));
    }
    return out;
  };
}

/** Analysten-Konsens: kaufen, wenn mehrere Banken (k) innerhalb von `days` Tagen hochstufen bzw. mit Kauf einsteigen. */
function konsens(data: BotSeries[], p: BotParams): PoolTrade[] {
  const out: PoolTrade[] = [];
  for (const d of data) {
    if (!d.analysts?.length || !isStock(d)) continue;
    const ups = d.analysts.filter((a) => isBuyGrade(a.toGrade) && (a.action === "up" || a.action === "init"));
    const downs = d.analysts.filter((a) => !isBuyGrade(a.toGrade) && a.action === "down");
    const sig: Signal[] = [];
    for (const a of ups) {
      const firms = new Set(ups.filter((b) => b.time <= a.time && b.time > a.time - p.days * DAY).map((b) => b.firm));
      sig.push({ t: a.time, buy: firms.size >= p.k, sell: false });
    }
    for (const a of downs) {
      const firms = new Set(downs.filter((b) => b.time <= a.time && b.time > a.time - p.days * DAY).map((b) => b.firm));
      sig.push({ t: a.time, buy: false, sell: firms.size >= p.k });
    }
    sig.sort((a, b) => a.t - b.t);
    out.push(...fromSignals(d.symbol, d.candles, sig, p.hold, p.sellOnDown === 1));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// 3) Die 5 bekannten Strategien

/** Dow-Jones-Mitglieder (nur Werte aus dem Turnier-Universum), mit Aufnahme/Ausscheiden – keine heutige Liste rückwirkend */
const DOW: Record<string, [number, number]> = {
  AAPL: [Date.UTC(2015, 2, 19), Infinity],
  AMZN: [Date.UTC(2024, 1, 26), Infinity],
  CRM: [Date.UTC(2020, 7, 31), Infinity],
  NVDA: [Date.UTC(2024, 10, 8), Infinity],
  UNH: [Date.UTC(2012, 8, 24), Infinity],
  V: [Date.UTC(2013, 8, 23), Infinity],
  XOM: [0, Date.UTC(2020, 7, 31)],
  INTC: [0, Date.UTC(2024, 10, 8)],
  CSCO: [0, Infinity],
  CVX: [0, Infinity],
  DIS: [0, Infinity],
  HD: [0, Infinity],
  JNJ: [0, Infinity],
  JPM: [0, Infinity],
  KO: [0, Infinity],
  MRK: [0, Infinity],
  MSFT: [0, Infinity],
  PG: [0, Infinity],
  WMT: [0, Infinity],
};
export const isDowMember = (sym: string, t: number) => {
  const m = DOW[sym];
  return !!m && t * 1000 >= m[0] && t * 1000 < m[1];
};

/** Dogs of the Dow: einmal im Jahr die n Dow-Werte mit der höchsten Dividendenrendite kaufen, ein Jahr halten. */
function dogs(data: BotSeries[], p: BotParams): PoolTrade[] {
  const out: PoolTrade[] = [];
  const pool = data.filter((d) => DOW[d.symbol] && d.dividends && isStock(d));
  if (!pool.length) return out;
  for (const { y, m, t } of months(data)) {
    if (m !== p.month) continue;
    const tNext = monthStart(y + 1, m);
    const ranked: { d: BotSeries; i: number; j: number; yld: number }[] = [];
    for (const d of pool) {
      if (!isDowMember(d.symbol, t)) continue;
      const c = d.candles;
      const i = atOrAfter(c, t);
      if (i < 200) continue;
      const j = atOrAfter(c, tNext);
      if (j < 0) continue;
      const entry = c[i].time;
      const paid = d.dividends!.filter((x) => x.time < entry && x.time >= entry - 365 * DAY).reduce((a, x) => a + x.amount, 0);
      const px = c[i - 1].close;
      if (px > 0) ranked.push({ d, i, j, yld: paid / px });
    }
    ranked.sort((a, b) => b.yld - a.yld || a.d.symbol.localeCompare(b.d.symbol));
    for (const x of ranked.slice(0, p.n)) {
      const tr = trade(x.d.symbol, x.d.candles, x.i, x.j);
      if (tr) out.push(tr);
    }
  }
  return out;
}

/** Monatlich die stärksten Aktien nach Rendite über `lookback` Monate – nur wenn auch der Markt (S&P 500) im Plus ist. */
function dualMomentum(data: BotSeries[], p: BotParams, ctx?: BotCtx): PoolTrade[] {
  const out: PoolTrade[] = [];
  const stocks = data.filter(isStock);
  const L = Math.round(p.lookback * 21);
  const held = new Map<string, number>(); // Symbol → Einstiegs-Index
  const ret = (c: Candle[], i: number) => (i - 1 - L >= 0 && c[i - 1 - L].close > 0 ? c[i - 1].close / c[i - 1 - L].close - 1 : null);
  for (const { t } of months(data)) {
    // Absolutes Momentum: S&P 500 über denselben Zeitraum im Plus (sonst „sicherer Hafen“ = Bargeld)
    let marketOk = true;
    if (ctx?.spx?.length) {
      const k = atOrAfter(ctx.spx, t);
      if (k < 0) break;
      const r = ret(ctx.spx, k);
      marketOk = r != null && r > 0;
    }
    const cand: { d: BotSeries; i: number; r: number }[] = [];
    let missing = false;
    for (const d of stocks) {
      const i = atOrAfter(d.candles, t);
      if (i < 0) {
        missing = true;
        continue;
      }
      const r = ret(d.candles, i);
      if (r != null && r > 0) cand.push({ d, i, r });
    }
    if (missing && !cand.length) break;
    cand.sort((a, b) => b.r - a.r || a.d.symbol.localeCompare(b.d.symbol));
    const pick = new Map((marketOk ? cand.slice(0, p.n) : []).map((x) => [x.d.symbol, x]));
    for (const d of stocks) {
      const at = held.get(d.symbol);
      if (at == null || pick.has(d.symbol)) continue;
      const j = atOrAfter(d.candles, t);
      if (j < 0) continue;
      const tr = trade(d.symbol, d.candles, at, j);
      if (tr) out.push(tr);
      held.delete(d.symbol);
    }
    for (const [sym, x] of pick) if (!held.has(sym)) held.set(sym, x.i);
  }
  return out;
}

/** 52-Wochen-Hoch (George & Hwang 2004): monatlich die Aktien am nächsten an ihrem Jahreshoch kaufen, Monate halten. */
function high52(data: BotSeries[], p: BotParams): PoolTrade[] {
  const out: PoolTrade[] = [];
  const stocks = data.filter(isStock);
  const busy = new Map<string, number>();
  for (const { y, m, t } of months(data)) {
    const tOut = monthStart(y + Math.floor((m + p.hold) / 12), (m + p.hold) % 12);
    const cand: { d: BotSeries; i: number; j: number; ratio: number }[] = [];
    for (const d of stocks) {
      const c = d.candles;
      const i = atOrAfter(c, t);
      if (i < 253 || c[i].time < (busy.get(d.symbol) ?? 0)) continue;
      let hi = 0;
      for (let k = i - 252; k < i; k++) hi = Math.max(hi, c[k].high);
      const ratio = hi > 0 ? c[i - 1].close / hi : 0;
      if (ratio < p.minRatio) continue;
      const j = atOrAfter(c, tOut);
      if (j < 0) continue;
      cand.push({ d, i, j, ratio });
    }
    cand.sort((a, b) => b.ratio - a.ratio || a.d.symbol.localeCompare(b.d.symbol));
    for (const x of cand.slice(0, p.n)) {
      const tr = trade(x.d.symbol, x.d.candles, x.i, x.j);
      if (tr) (out.push(tr), busy.set(x.d.symbol, tr.exit));
    }
  }
  return out;
}

/** Connors RSI-2: über der langen Durchschnittslinie und RSI(2) tief → kaufen; über der 5-Tage-Linie → verkaufen. */
function connors(data: BotSeries[], p: BotParams): PoolTrade[] {
  const out: PoolTrade[] = [];
  for (const d of data.filter(isStock)) {
    const c = d.candles;
    const cl = c.map((x) => x.close);
    const r = rsi(cl, 2);
    const mL = sma(cl, p.trend);
    const mS = sma(cl, p.exitSma);
    let inAt = -1;
    for (let i = p.trend; i < c.length - 1; i++) {
      if (inAt < 0 && mL[i] != null && r[i] != null && cl[i] > mL[i]! && r[i]! < p.entry) inAt = i + 1;
      else if (inAt >= 0 && i >= inAt && mS[i] != null && cl[i] > mS[i]!) {
        const t = trade(d.symbol, c, inAt, i + 1);
        if (t) out.push(t);
        inAt = -1;
      }
    }
  }
  return out;
}

/** Sell in May (Halloween-Effekt): im Herbst einen breiten Aktienkorb kaufen, im Frühjahr verkaufen, Sommer in Bargeld. */
function sellInMay(data: BotSeries[], p: BotParams): PoolTrade[] {
  const out: PoolTrade[] = [];
  const stocks = data.filter(isStock);
  for (const { y, m, t } of months(data)) {
    if (m !== p.inMonth) continue;
    const tOut = monthStart(y + 1, p.outMonth);
    // Korb: n Werte, jedes Jahr neu gemischt (wie ein Index-Ausschnitt; keine Auswahl nach Kursen)
    const r = rng(y * 31 + 7);
    const order = stocks.map((d) => ({ d, k: r() })).sort((a, b) => a.k - b.k).map((x) => x.d);
    let n = 0;
    for (const d of order) {
      if (n >= p.n) break;
      const i = atOrAfter(d.candles, t);
      const j = atOrAfter(d.candles, tOut);
      if (i < 1 || j < 0) continue;
      const tr = trade(d.symbol, d.candles, i, j);
      if (tr) (out.push(tr), n++);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Die 15 Gegner

const P = (key: string, label: string, min: number, max: number, step: number): ParamDef => ({ key, label, min, max, step });
const MON = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const days = (n: number) => `${n} Tage`;
const bank = (id: string, name: string, firm: RegExp): Opponent => ({
  id,
  name,
  group: "bank",
  desc: `kauft am Tag nach einer Hochstufung auf „Kaufen/Übergewichten“ durch ${name.replace("Analyst ", "")}`,
  source: "Yahoo-Einstufungen ab 2012, nur US-Aktien",
  space: [P("hold", "Haltedauer (Handelstage)", 63, 252, 21), P("sellOnDown", "Verkauf bei Abstufung", 0, 1, 1), P("reit", "auch bei bestätigter Kaufempfehlung", 0, 1, 1)],
  defaults: { hold: 252, sellOnDown: 1, reit: 0 },
  describe: (p) => `hält ${days(p.hold)}${p.sellOnDown ? ", verkauft bei Abstufung" : ""}${p.reit ? ", kauft auch bei Bestätigung" : ""}`,
  build: bankBot(firm),
});

export const OPPONENTS: Opponent[] = [
  // Bots
  { id: "zufall", name: "Zufalls-Bot", group: "bot", desc: "kauft an zufälligen Tagen", space: [P("hold", "Haltedauer", 10, 60, 5), P("seed", "Zufallszahl", 1, 999, 1)], defaults: { hold: 20, seed: 7 }, describe: (p) => `hält ${days(p.hold)}`, build: zufall },
  { id: "halten", name: "Kaufen & Halten", group: "bot", desc: "kauft regelmäßig und lässt liegen", space: [P("every", "kauft alle … Tage", 10, 42, 1), P("hold", "Haltedauer", 63, 252, 21)], defaults: { every: 21, hold: 126 }, describe: (p) => `kauft alle ${p.every} Tage, hält ${days(p.hold)}`, build: kaufenHalten },
  { id: "trend", name: "Trendfolger", group: "bot", desc: "kauft über der Durchschnittslinie, verkauft darunter", space: [P("sma", "Durchschnittslinie (Tage)", 100, 250, 10)], defaults: { sma: 200 }, describe: (p) => `${p.sma}-Tage-Linie`, build: trendfolger },
  { id: "ausbruch", name: "Ausbruchs-Bot (Turtle)", group: "bot", desc: "kauft beim Hoch, verkauft beim Tief", source: "Turtle Trading (Dennis/Eckhardt, 1983)", space: [P("entry", "Hoch über (Tage)", 20, 60, 5), P("exit", "Tief über (Tage)", 10, 30, 5)], defaults: { entry: 55, exit: 20 }, describe: (p) => `${p.entry}-Tage-Hoch / ${Math.min(p.exit, p.entry)}-Tage-Tief`, build: ausbruch },
  { id: "ki", name: "KI-Bot", group: "bot", desc: "lernende KI (logistische Regression), lernt jedes Jahr neu", heavy: true, space: [P("thr", "Mindest-Wahrscheinlichkeit", 0.54, 0.62, 0.01), P("hold", "Haltedauer", 10, 30, 5)], defaults: { thr: 0.58, hold: 20 }, describe: (p) => `ab ${Math.round(p.thr * 100)} %, hält ${days(p.hold)}`, build: kiBot },
  // Bank-Analysten
  bank("gs", "Analyst Goldman Sachs", /goldman/i),
  bank("ms", "Analyst Morgan Stanley", /morgan stanley/i),
  bank("jpm", "Analyst JPMorgan", /j\.?\s?p\.?\s?morgan/i),
  bank("bofa", "Analyst Bank of America", /b of a|bofa|bank of america|merrill/i),
  {
    id: "konsens",
    name: "Analysten-Konsens",
    group: "bank",
    desc: "kauft, wenn mehrere Banken kurz nacheinander hochstufen",
    source: "Yahoo-Einstufungen ab 2012, nur US-Aktien",
    space: [P("k", "Banken (mindestens)", 2, 4, 1), P("days", "innerhalb von (Kalendertagen)", 15, 45, 5), P("hold", "Haltedauer", 63, 252, 21), P("sellOnDown", "Verkauf bei mehreren Abstufungen", 0, 1, 1)],
    defaults: { k: 2, days: 30, hold: 252, sellOnDown: 1 },
    describe: (p) => `${p.k} Banken in ${p.days} Tagen, hält ${days(p.hold)}${p.sellOnDown ? ", verkauft bei Abstufungen" : ""}`,
    build: konsens,
  },
  // Strategien
  { id: "dogs", name: "Dogs of the Dow", group: "strategie", desc: "kauft jährlich die Dow-Werte mit der höchsten Dividendenrendite, hält ein Jahr", source: "O'Higgins, „Beating the Dow“ (1991)", space: [P("n", "Anzahl Werte", 5, 10, 1), P("month", "Kaufmonat", 0, 11, 1)], defaults: { n: 10, month: 0 }, describe: (p) => `${p.n} Werte, Kauf im ${MON[p.month]}`, build: dogs },
  { id: "dualmom", name: "Dual Momentum", group: "strategie", desc: "kauft monatlich die stärksten Aktien – nur wenn der Markt im Plus ist", source: "Antonacci, „Dual Momentum Investing“ (2014)", space: [P("lookback", "Rückblick (Monate)", 6, 12, 1), P("n", "Anzahl Werte", 5, 15, 1)], defaults: { lookback: 12, n: 10 }, describe: (p) => `${p.lookback} Monate Rückblick, ${p.n} Werte`, build: dualMomentum },
  { id: "high52", name: "52-Wochen-Hoch", group: "strategie", desc: "kauft monatlich die Aktien am nächsten an ihrem Jahreshoch", source: "George & Hwang, Journal of Finance (2004)", space: [P("n", "Anzahl Werte", 5, 15, 1), P("hold", "Haltedauer (Monate)", 3, 12, 1), P("minRatio", "mindestens % vom Hoch", 0.85, 0.98, 0.01)], defaults: { n: 10, hold: 6, minRatio: 0.9 }, describe: (p) => `${p.n} Werte, ab ${Math.round(p.minRatio * 100)} % vom Hoch, hält ${p.hold} Monate`, build: high52 },
  { id: "connors", name: "Connors RSI-2", group: "strategie", desc: "kauft kurze Rücksetzer im Aufwärtstrend, verkauft bei Erholung", source: "Connors & Alvarez, „Short Term Trading Strategies That Work“ (2008)", space: [P("entry", "RSI(2) unter", 2, 10, 1), P("exitSma", "Verkauf über (Tage-Linie)", 5, 10, 1), P("trend", "Trend-Linie (Tage)", 150, 250, 10)], defaults: { entry: 10, exitSma: 5, trend: 200 }, describe: (p) => `RSI(2) < ${p.entry}, über ${p.trend}-Tage-Linie, raus über ${p.exitSma}-Tage-Linie`, build: connors },
  { id: "sellmay", name: "Sell in May", group: "strategie", desc: "Aktienkorb im Herbst kaufen, im Frühjahr verkaufen", source: "Bouman & Jacobsen, American Economic Review (2002)", space: [P("inMonth", "Kaufmonat", 9, 10, 1), P("outMonth", "Verkaufsmonat", 3, 5, 1), P("n", "Anzahl Werte", 10, 15, 1)], defaults: { inMonth: 10, outMonth: 4, n: 15 }, describe: (p) => `${MON[p.inMonth]} bis ${MON[p.outMonth]}, ${p.n} Werte`, build: sellInMay },
];

// ---------------------------------------------------------------------------------------------
// Varianten: Champion + neue Zufalls-Varianten (innerhalb der fairen Bereiche)

const snap = (d: ParamDef, v: number) => {
  const x = Math.min(d.max, Math.max(d.min, d.min + Math.round((v - d.min) / d.step) * d.step));
  return Math.round(x * 1e6) / 1e6;
};

/** Gültige Parameter (fehlende → Standard, außerhalb des Bereichs → Rand) */
export function cleanParams(o: Opponent, p?: BotParams | null): BotParams {
  const out: BotParams = {};
  for (const d of o.space) out[d.key] = snap(d, typeof p?.[d.key] === "number" && isFinite(p[d.key]) ? p[d.key] : o.defaults[d.key]);
  return out;
}

export type VariantOrigin = "champion" | "start" | "neu";

/** Kandidaten für die Auswahl: Champion (oder Standard) + Abwandlungen + eine ganz neue Variante. */
export function makeVariants(o: Opponent, champion: BotParams | null | undefined, seed: number, count = o.heavy ? 2 : 4): { params: BotParams; origin: VariantOrigin }[] {
  const base = cleanParams(o, champion);
  const out: { params: BotParams; origin: VariantOrigin }[] = [{ params: base, origin: champion ? "champion" : "start" }];
  const seen = new Set([JSON.stringify(base)]);
  const r = rng(seed);
  for (let tries = 0; out.length < count && tries < 60; tries++) {
    // letzte Variante (oder wenn Abwandlungen nichts Neues bringen): ganz neu gewürfelt
    const fresh = out.length === count - 1 || tries >= 30;
    const p: BotParams = {};
    const pickKey = Math.floor(r() * o.space.length);
    o.space.forEach((d, n) => {
      const span = d.max - d.min;
      if (fresh) p[d.key] = snap(d, d.min + r() * (span + d.step) - d.step / 2);
      else if (n === pickKey || r() < 0.4) {
        // Abwandlung: mindestens ein Schritt, höchstens ein Viertel des Bereichs
        const size = Math.max(d.step, Math.round((r() * 0.25 * span) / d.step) * d.step);
        const dir = base[d.key] + size > d.max ? -1 : base[d.key] - size < d.min ? 1 : r() < 0.5 ? -1 : 1;
        p[d.key] = snap(d, base[d.key] + dir * size);
      } else p[d.key] = base[d.key];
    });
    const k = JSON.stringify(p);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ params: p, origin: "neu" });
  }
  return out;
}
