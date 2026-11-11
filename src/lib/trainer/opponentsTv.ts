// Zusätzliche Gegner (Shipmaster 0.1, Wunsch des Nutzers 11.11.2026): 9 auf TradingView typische Strategien/Bots und
// die 4 stärksten Gegner aus dem großen Härtetest. Nachgebaut nach den öffentlich bekannten Regeln (kein fremder Code).
// Wie alle Gegner: Signal am Tagesschluss → Kauf/Verkauf zur Eröffnung am nächsten Handelstag (kein Blick voraus),
// faire Stellschrauben, gleiche Konto-Regeln wie Blacktrader (Shipmaster 0.1, Gebühren, KESt, pleite = raus).
import { atr, ema, rsi, sma } from "../analysis/indicators";
import type { Candle } from "../types";
import type { BotParams, BotSeries, Opponent, ParamDef } from "./opponents";
import { trade } from "./opponents";
import type { PoolTrade } from "./tournament";

const P = (key: string, label: string, min: number, max: number, step: number): ParamDef => ({ key, label, min, max, step });
const isStock = (d: BotSeries) => (d.kind ? d.kind === "stock" : true) && !d.symbol.startsWith("^");
const n0 = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? NaN : x);

/** Allgemeiner Regel-Bot: enter(i)/exit(i) am Schluss von Tag i → Ein-/Ausstieg zur Eröffnung von Tag i+1 */
function ruleBot(data: BotSeries[], prep: (c: Candle[]) => { warm: number; enter: (i: number) => boolean; exit: (i: number, entryIdx: number) => boolean }): PoolTrade[] {
  const out: PoolTrade[] = [];
  for (const d of data) {
    const c = d.candles;
    if (c.length < 260) continue;
    const r = prep(c);
    let inAt = -1;
    for (let i = Math.max(1, r.warm); i < c.length - 1; i++) {
      if (inAt < 0) {
        if (r.enter(i)) inAt = i + 1;
      } else if (i >= inAt && r.exit(i, inAt)) {
        const t = trade(d.symbol, c, inAt, i + 1);
        if (t) out.push(t);
        inAt = -1;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------- TradingView-typisch

function supertrend(data: BotSeries[], p: BotParams) {
  return ruleBot(data, (c) => {
    const a = atr(c, p.atr);
    const up = new Float64Array(c.length);
    const dn = new Float64Array(c.length);
    const dir = new Int8Array(c.length);
    for (let i = 0; i < c.length; i++) {
      const hl2 = (c[i].high + c[i].low) / 2;
      const v = n0(a[i]);
      if (!(v > 0)) { up[i] = NaN; dn[i] = NaN; dir[i] = i ? dir[i - 1] : 1; continue; }
      const bu = hl2 - p.mult * v;
      const bd = hl2 + p.mult * v;
      up[i] = i && up[i - 1] === up[i - 1] && c[i - 1].close > up[i - 1] ? Math.max(bu, up[i - 1]) : bu;
      dn[i] = i && dn[i - 1] === dn[i - 1] && c[i - 1].close < dn[i - 1] ? Math.min(bd, dn[i - 1]) : bd;
      const prev = i ? dir[i - 1] || 1 : 1;
      dir[i] = prev === -1 && c[i].close > dn[i - 1] ? 1 : prev === 1 && c[i].close < up[i - 1] ? -1 : prev;
    }
    return { warm: p.atr + 2, enter: (i) => dir[i] === 1 && dir[i - 1] === -1, exit: (i) => dir[i] === -1 };
  });
}

function rsiStrategy(data: BotSeries[], p: BotParams) {
  return ruleBot(data, (c) => {
    const r = rsi(c.map((x) => x.close), 14);
    return { warm: 20, enter: (i) => n0(r[i]) < p.low && n0(r[i - 1]) >= p.low, exit: (i) => n0(r[i]) > p.high };
  });
}

function macdStrategy(data: BotSeries[], p: BotParams) {
  return ruleBot(data, (c) => {
    const cl = c.map((x) => x.close);
    const f = ema(cl, p.fast), s = ema(cl, p.slow);
    const m = cl.map((_, i) => (f[i] != null && s[i] != null ? f[i]! - s[i]! : NaN));
    const first = m.findIndex((x) => x === x);
    const sig = first < 0 ? m.map(() => NaN) : [...m.slice(0, first).map(() => NaN), ...ema(m.slice(first), p.signal).map((x) => n0(x))];
    return { warm: p.slow + p.signal, enter: (i) => m[i] > sig[i] && m[i - 1] <= sig[i - 1], exit: (i) => m[i] < sig[i] };
  });
}

function bollinger(data: BotSeries[], p: BotParams) {
  return ruleBot(data, (c) => {
    const cl = c.map((x) => x.close);
    const m = sma(cl, p.len);
    const sd = cl.map((_, i) => {
      if (i < p.len - 1 || m[i] == null) return NaN;
      let q = 0;
      for (let k = i - p.len + 1; k <= i; k++) q += (cl[k] - m[i]!) ** 2;
      return Math.sqrt(q / p.len);
    });
    return { warm: p.len, enter: (i) => cl[i] < n0(m[i]) - p.k * sd[i] && cl[i - 1] >= n0(m[i - 1]) - p.k * sd[i - 1], exit: (i) => cl[i] > n0(m[i]) };
  });
}

function emaCross(data: BotSeries[], p: BotParams) {
  return ruleBot(data, (c) => {
    const cl = c.map((x) => x.close);
    const f = ema(cl, p.fast), s = ema(cl, p.slow);
    return { warm: p.slow + 1, enter: (i) => n0(f[i]) > n0(s[i]) && n0(f[i - 1]) <= n0(s[i - 1]), exit: (i) => n0(f[i]) < n0(s[i]) };
  });
}

function ichimoku(data: BotSeries[], p: BotParams) {
  return ruleBot(data, (c) => {
    const midArr = (n: number) =>
      c.map((_, i) => {
        if (i < n - 1) return NaN;
        let hi = -Infinity, lo = Infinity;
        for (let k = i - n + 1; k <= i; k++) (hi = Math.max(hi, c[k].high), (lo = Math.min(lo, c[k].low)));
        return (hi + lo) / 2;
      });
    const t = midArr(p.tenkan), k = midArr(p.kijun), m52 = midArr(52);
    // Wolke für Tag i: Spannen A/B, die vor `shift` Tagen berechnet wurden (nur Vergangenheit)
    const top = (i: number) => (i - p.shift >= 52 ? Math.max((t[i - p.shift] + k[i - p.shift]) / 2, m52[i - p.shift]) : NaN);
    const bottom = (i: number) => (i - p.shift >= 52 ? Math.min((t[i - p.shift] + k[i - p.shift]) / 2, m52[i - p.shift]) : NaN);
    return { warm: 52 + p.shift + 1, enter: (i) => c[i].close > top(i) && c[i - 1].close <= top(i - 1), exit: (i) => c[i].close < bottom(i) };
  });
}

function parabolicSar(data: BotSeries[], p: BotParams) {
  return ruleBot(data, (c) => {
    const sar = new Float64Array(c.length);
    const up = new Int8Array(c.length);
    let isUp = true, af = p.step, ep = c[0].high, s = c[0].low;
    for (let i = 1; i < c.length; i++) {
      s = s + af * (ep - s);
      if (isUp) {
        s = Math.min(s, c[i - 1].low, i > 1 ? c[i - 2].low : c[i - 1].low);
        if (c[i].low < s) { isUp = false; s = ep; ep = c[i].low; af = p.step; }
        else if (c[i].high > ep) { ep = c[i].high; af = Math.min(p.max, af + p.step); }
      } else {
        s = Math.max(s, c[i - 1].high, i > 1 ? c[i - 2].high : c[i - 1].high);
        if (c[i].high > s) { isUp = true; s = ep; ep = c[i].high; af = p.step; }
        else if (c[i].low < ep) { ep = c[i].low; af = Math.min(p.max, af + p.step); }
      }
      sar[i] = s;
      up[i] = isUp ? 1 : 0;
    }
    return { warm: 5, enter: (i) => up[i] === 1 && up[i - 1] === 0, exit: (i) => up[i] === 0 };
  });
}

function stochastic(data: BotSeries[], p: BotParams) {
  return ruleBot(data, (c) => {
    const k = c.map((_, i) => {
      if (i < p.len - 1) return NaN;
      let hi = -Infinity, lo = Infinity;
      for (let j = i - p.len + 1; j <= i; j++) (hi = Math.max(hi, c[j].high), (lo = Math.min(lo, c[j].low)));
      return hi > lo ? ((c[i].close - lo) / (hi - lo)) * 100 : 50;
    });
    const ks = sma(k.map((x) => (x === x ? x : 50)), 3).map(n0);
    return { warm: p.len + 3, enter: (i) => ks[i] > p.low && ks[i - 1] <= p.low, exit: (i) => ks[i] > p.high };
  });
}

function adxDmi(data: BotSeries[], p: BotParams) {
  return ruleBot(data, (c) => {
    const n = c.length;
    const plus = new Float64Array(n), minus = new Float64Array(n), adx = new Float64Array(n).fill(NaN);
    let tr = 0, pdm = 0, mdm = 0, adxv = NaN;
    const dxs: number[] = [];
    for (let i = 1; i < n; i++) {
      const up = c[i].high - c[i - 1].high, dn = c[i - 1].low - c[i].low;
      const t = Math.max(c[i].high - c[i].low, Math.abs(c[i].high - c[i - 1].close), Math.abs(c[i].low - c[i - 1].close));
      const L = p.len;
      tr = i <= L ? tr + t : tr - tr / L + t;
      pdm = i <= L ? pdm + (up > dn && up > 0 ? up : 0) : pdm - pdm / L + (up > dn && up > 0 ? up : 0);
      mdm = i <= L ? mdm + (dn > up && dn > 0 ? dn : 0) : mdm - mdm / L + (dn > up && dn > 0 ? dn : 0);
      if (i < L || !(tr > 0)) continue;
      plus[i] = (100 * pdm) / tr;
      minus[i] = (100 * mdm) / tr;
      const dx = plus[i] + minus[i] > 0 ? (100 * Math.abs(plus[i] - minus[i])) / (plus[i] + minus[i]) : 0;
      if (adxv !== adxv) {
        dxs.push(dx);
        if (dxs.length === L) adxv = dxs.reduce((a, b) => a + b, 0) / L;
      } else adxv = (adxv * (L - 1) + dx) / L;
      adx[i] = adxv;
    }
    return { warm: 2 * p.len + 1, enter: (i) => adx[i] > p.adx && plus[i] > minus[i] && !(adx[i - 1] > p.adx && plus[i - 1] > minus[i - 1]), exit: (i) => plus[i] < minus[i] };
  });
}

// ---------------------------------------------------------------------------------------------- stärkste aus dem Härtetest

/** Golden Cross: 50-Tage-Linie kreuzt die 200-Tage-Linie nach oben / unten */
function goldenCross(data: BotSeries[], p: BotParams) {
  return ruleBot(data.filter(isStock), (c) => {
    const cl = c.map((x) => x.close);
    const f = sma(cl, p.fast), s = sma(cl, p.slow);
    return { warm: p.slow + 1, enter: (i) => n0(f[i]) > n0(s[i]) && n0(f[i - 1]) <= n0(s[i - 1]), exit: (i) => n0(f[i]) < n0(s[i]) };
  });
}

/** Rangliste-Bot: zu jedem Monats-/Quartals-/Jahresanfang die besten n halten (Kauf/Verkauf am nächsten Tag) */
function rankBot(data: BotSeries[], n: number, every: 1 | 3 | 12, score: (c: Candle[], i: number) => number): PoolTrade[] {
  const stocks = data.filter(isStock).filter((d) => d.candles.length > 260);
  const out: PoolTrade[] = [];
  if (!stocks.length) return out;
  const days = new Set<number>();
  for (const d of stocks) for (const c of d.candles) days.add(c.time);
  const cal = [...days].sort((a, b) => a - b);
  const idx = stocks.map((d) => new Map(d.candles.map((c, i) => [c.time, i])));
  const held = new Map<number, number>(); // Aktie → Kerzen-Index des Einstiegs
  let lastKey = "";
  for (const t of cal) {
    const dt = new Date(t * 1000);
    const key = `${dt.getUTCFullYear()}-${Math.floor(dt.getUTCMonth() / every)}`;
    if (key === lastKey) continue;
    lastKey = key;
    const cand: [number, number][] = [];
    stocks.forEach((d, s) => {
      const i = idx[s].get(t);
      if (i == null || i + 1 >= d.candles.length || i < 253) return;
      const v = score(d.candles, i);
      if (v === v) cand.push([s, v]);
    });
    cand.sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    const top = new Set(cand.slice(0, n).map(([s]) => s));
    for (const [s, e] of [...held]) {
      if (top.has(s)) continue;
      const i = idx[s].get(t);
      if (i == null) continue;
      const tr = trade(stocks[s].symbol, stocks[s].candles, e, i + 1);
      if (tr) out.push(tr);
      held.delete(s);
    }
    for (const s of top) if (!held.has(s)) held.set(s, idx[s].get(t)! + 1);
  }
  for (const [s, e] of held) {
    const c = stocks[s].candles;
    const tr = trade(stocks[s].symbol, c, e, c.length - 1);
    if (tr) out.push(tr);
  }
  return out;
}

const ret = (c: Candle[], i: number, back: number) => (i - back >= 0 && c[i - back].close > 0 ? c[i].close / c[i - back].close - 1 : NaN);
function vol(c: Candle[], i: number) {
  let m = 0, q = 0, k = 0;
  for (let j = i - 251; j <= i; j++) {
    const r = c[j].close / c[j - 1].close - 1;
    if (!Number.isFinite(r)) return NaN;
    m += r; q += r * r; k++;
  }
  m /= k;
  return Math.sqrt(Math.max(0, q / k - m * m));
}

const MON: Record<number, string> = { 1: "monatlich", 3: "vierteljährlich", 12: "jährlich" };

export const TV_OPPONENTS: Opponent[] = [
  { id: "tv_supertrend", name: "TradingView: Supertrend", group: "bot", desc: "kauft, wenn Supertrend auf grün dreht, verkauft bei rot", source: "TradingView-Standardindikator", space: [P("atr", "ATR-Länge", 7, 14, 1), P("mult", "Faktor", 2, 4, 0.5)], defaults: { atr: 10, mult: 3 }, describe: (p) => `ATR ${p.atr}, Faktor ${p.mult}`, build: supertrend },
  { id: "tv_rsi", name: "TradingView: RSI-Strategie", group: "bot", desc: "kauft unter RSI 30, verkauft über RSI 70", source: "TradingView „RSI Strategy“", space: [P("low", "Kauf unter", 20, 35, 5), P("high", "Verkauf über", 65, 80, 5)], defaults: { low: 30, high: 70 }, describe: (p) => `RSI < ${p.low} / > ${p.high}`, build: rsiStrategy },
  { id: "tv_macd", name: "TradingView: MACD-Strategie", group: "bot", desc: "kauft, wenn MACD die Signallinie nach oben kreuzt", source: "TradingView „MACD Strategy“", space: [P("fast", "schnell", 8, 16, 1), P("slow", "langsam", 20, 32, 2), P("signal", "Signal", 7, 11, 1)], defaults: { fast: 12, slow: 26, signal: 9 }, describe: (p) => `${p.fast}/${p.slow}/${p.signal}`, build: macdStrategy },
  { id: "tv_bollinger", name: "TradingView: Bollinger-Bänder", group: "bot", desc: "kauft am unteren Band, verkauft an der Mittellinie", source: "TradingView „Bollinger Bands Strategy“", space: [P("len", "Länge", 15, 30, 5), P("k", "Breite", 1.5, 2.5, 0.5)], defaults: { len: 20, k: 2 }, describe: (p) => `${p.len} Tage, ${p.k}-fach`, build: bollinger },
  { id: "tv_ema", name: "TradingView: EMA-Kreuzung 9/21", group: "bot", desc: "kauft, wenn EMA 9 über EMA 21 kreuzt", source: "TradingView „MovingAvg2Line Cross“", space: [P("fast", "schnell", 5, 12, 1), P("slow", "langsam", 18, 30, 3)], defaults: { fast: 9, slow: 21 }, describe: (p) => `EMA ${p.fast}/${p.slow}`, build: emaCross },
  { id: "tv_ichimoku", name: "TradingView: Ichimoku-Wolke", group: "bot", desc: "kauft beim Ausbruch über die Wolke, verkauft darunter", source: "TradingView „Ichimoku Cloud“", space: [P("tenkan", "Tenkan", 7, 11, 1), P("kijun", "Kijun", 22, 30, 2), P("shift", "Verschiebung", 22, 30, 2)], defaults: { tenkan: 9, kijun: 26, shift: 26 }, describe: (p) => `${p.tenkan}/${p.kijun}/52`, build: ichimoku },
  { id: "tv_psar", name: "TradingView: Parabolic SAR", group: "bot", desc: "kauft, wenn SAR unter den Kurs springt", source: "TradingView „Parabolic SAR Strategy“", space: [P("step", "Schritt", 0.01, 0.03, 0.01), P("max", "Maximum", 0.15, 0.25, 0.05)], defaults: { step: 0.02, max: 0.2 }, describe: (p) => `${p.step}/${p.max}`, build: parabolicSar },
  { id: "tv_stoch", name: "TradingView: Stochastik", group: "bot", desc: "kauft, wenn %K von unter 20 nach oben dreht, verkauft über 80", source: "TradingView „Stochastic Slow Strategy“", space: [P("len", "Länge", 10, 21, 1), P("low", "Kauf über", 15, 25, 5), P("high", "Verkauf über", 75, 85, 5)], defaults: { len: 14, low: 20, high: 80 }, describe: (p) => `${p.len} Tage, ${p.low}/${p.high}`, build: stochastic },
  { id: "tv_adx", name: "TradingView: ADX/DMI-Trend", group: "bot", desc: "kauft bei starkem Trend (ADX) und +DI über −DI", source: "TradingView „ADX and DI“", space: [P("len", "Länge", 10, 20, 2), P("adx", "ADX über", 20, 30, 5)], defaults: { len: 14, adx: 25 }, describe: (p) => `${p.len} Tage, ADX > ${p.adx}`, build: adxDmi },
];

export const HARDTEST_OPPONENTS: Opponent[] = [
  { id: "ht_golden", name: "Golden Cross", group: "strategie", desc: "kauft, wenn die 50-Tage-Linie die 200-Tage-Linie nach oben kreuzt", source: "Härtetest 11.11.2026", space: [P("fast", "schnelle Linie", 40, 60, 10), P("slow", "langsame Linie", 150, 250, 50)], defaults: { fast: 50, slow: 200 }, describe: (p) => `${p.fast}/${p.slow}`, build: goldenCross },
  { id: "ht_momentum", name: "Momentum (12 Monate)", group: "strategie", desc: "hält jeden Monat die 10 Aktien mit dem stärksten Jahr", source: "Härtetest 11.11.2026 (Jegadeesh & Titman 1993)", space: [P("n", "Anzahl Werte", 5, 15, 1)], defaults: { n: 10 }, describe: (p) => `${p.n} Werte, monatlich`, build: (d, p) => rankBot(d, p.n, 1, (c, i) => ret(c, i - 21, 231)) },
  { id: "ht_bluechip", name: "Blue-Chip-Korb", group: "strategie", desc: "hält die Werte mit der längsten Kursgeschichte, jährlich neu", source: "Härtetest 11.11.2026", space: [P("n", "Anzahl Werte", 5, 15, 1)], defaults: { n: 10 }, describe: (p) => `${p.n} Werte, ${MON[12]}`, build: (d, p) => rankBot(d, p.n, 12, (_c, i) => i) },
  { id: "ht_lowvol", name: "Niedrige Schwankung", group: "strategie", desc: "hält die Aktien mit der geringsten Schwankung im letzten Jahr", source: "Härtetest 11.11.2026 (Low-Volatility-Anomalie)", space: [P("n", "Anzahl Werte", 5, 15, 1)], defaults: { n: 10 }, describe: (p) => `${p.n} Werte, ${MON[3]}`, build: (d, p) => rankBot(d, p.n, 3, (c, i) => -vol(c, i)) },
];
