// Fasst alle Analyse-Module zu einem Ergebnis zusammen.
import { HORIZON_LABEL, type Candle, type Fundamentals, type Horizon, type Interval, type NewsItem } from "../types";
import { analyzeElliott, degreesFrom, type ElliottResult } from "./elliott";
import { aggregateCandles } from "../data/aggregate";
import { atr, ema } from "./indicators";
import { DEFAULT_ZONE_OPTIONS, findZoneSetup } from "./zones";
import { DEFAULT_PARAMS, type LearnableParams } from "./params";
import { withFibToleranceScale } from "./elliott/fib";
import { analyzeFundamentals, type FundamentalResult } from "./fundamental";
import { writeCommentary, type Commentary } from "./persona";
import { DEFAULT_WEIGHTS, MIN_RISK_REWARD, type SignalDecision, type TradePlan, type Weights, buildPlan, decideSignal, levelFromScore, totalScore } from "./score";
import { analyzeVolumeRsi, type VolumeRsiResult } from "./volume";

export interface AnalysisResult {
  symbol: string;
  horizon: Horizon;
  interval: Interval;
  price: number;
  time: number;
  elliott: ElliottResult;
  fundamental: FundamentalResult;
  volume: VolumeRsiResult;
  total: number;
  /** Tatsächlich verwendete Gewichtung */
  weights: Weights;
  decision: SignalDecision;
  plan: TradePlan | null;
  commentary: Commentary;
  /** Währung des Werts (Anzeige in Euro wird daraus umgerechnet) */
  currency?: string;
}

/** Zusätzliche, strengere Prüfungen (machen Einstiege nie leichter). */
export interface AnalyzerFilters {
  /** Nur in Richtung des übergeordneten Trends (EMA 50/200) handeln */
  trend: "off" | "no-counter" | "with";
  /** Letzte Kerze muss in Signalrichtung schließen */
  confirm: boolean;
  /** Mindestabstand des Stops in ATR */
  minStopAtr: number;
}

/**
 * Standard nach Messung auf echten Kursreihen (S&P 500, Google, EUR/USD, Gold 2016):
 * Trendfilter + Stop mit mind. 2 ATR Abstand verbesserten Trefferquote und Gewinnfaktor
 * auf Entwicklungs- und Prüfdaten gegenüber ohne Filter. Siehe scripts/evaluate.ts.
 */
export const DEFAULT_FILTERS: AnalyzerFilters = { trend: "with", confirm: false, minStopAtr: 2 };

export interface AnalyzeInput {
  symbol: string;
  name: string;
  candles: Candle[];
  horizon: Horizon;
  interval: Interval;
  fundamentals?: Fundamentals | null;
  news?: NewsItem[];
  weights?: Weights;
  /** Aktueller Live-Kurs (überschreibt den letzten Schlusskurs) */
  livePrice?: number;
  filters?: Partial<AnalyzerFilters>;
  /** "zone" = Zielzonen-Einstieg (Standard), "elliott" = alter Sofort-Einstieg (nur für Vergleichsmessungen) */
  mode?: "zone" | "elliott";
  /** Lernbare Stellschrauben (Trainer). Fehlt = Standardwerte (identisch zum bisherigen Verhalten). */
  params?: Partial<LearnableParams>;
  kind?: "stock" | "crypto" | "commodity";
  /** Währung für Texte, z. B. EUR */
  currency?: string;
  now?: number;
}

const MAX_CANDLES = 600;

const INTERVAL_SEC: Record<Interval, number> = { "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400, "1w": 604800, "1M": 2592000 };
/** Übergeordnete Zeitebene je Kerzengröße */
const HIGHER_SEC: Record<Interval, number> = { "5m": 3600, "15m": 3600, "1h": 14400, "4h": 86400, "1d": 604800, "1w": 28 * 86400, "1M": 90 * 86400 };

/**
 * Lernbare Elliott-Prüfungen (Standard: alle aus). Jede kann ein Signal nur verhindern.
 * - Wellenbild bestätigt die Richtung (elliottAgreement)
 * - Kein Einstieg am Ende von Welle 5 (fertiger Impuls in Trade-Richtung oder Divergenz am Extrem)
 * - Übergeordnete Zeitebene widerspricht nicht
 */
export function elliottVetoes(dir: 1 | -1, candles: Candle[], interval: Interval, elliott: ElliottResult, volume: VolumeRsiResult, P: LearnableParams): string[] {
  const v: string[] = [];
  if (P.elliottAgreement > 0) {
    const ok = dir === 1 ? elliott.score >= 50 + P.elliottAgreement : elliott.score <= 50 - P.elliottAgreement;
    if (!ok) v.push("Wellenbild bestätigt die Richtung nicht deutlich genug");
  }
  if (P.wave5Filter) {
    const b = elliott.best;
    const doneImpulse = !!b && (b.pattern === "impulse" || b.pattern === "ending-diagonal") && b.complete && b.direction === dir;
    const div = volume.divergences.some((d) => d.type === (dir === 1 ? "bearish" : "bullish"));
    if (doneImpulse || div) v.push("Welle 5 könnte gerade enden – Einstieg zu spät");
  }
  if (P.htfConfirm) {
    const htf = aggregateCandles(candles, Math.max(HIGHER_SEC[interval], INTERVAL_SEC[interval] * 2));
    if (htf.length >= 40) {
      const e = analyzeElliott(htf);
      if (e.best && e.best.bias !== dir && (dir === 1 ? e.score < 50 : e.score > 50)) v.push("Übergeordnete Welle spricht dagegen");
    }
  }
  return v;
}

export function analyze(input: AnalyzeInput): AnalysisResult | null {
  let candles = input.candles.slice(-MAX_CANDLES);
  if (candles.length < 30) return null;
  if (input.livePrice && input.livePrice > 0) {
    const last = { ...candles[candles.length - 1] };
    last.close = input.livePrice;
    last.high = Math.max(last.high, input.livePrice);
    last.low = Math.min(last.low, input.livePrice);
    candles = [...candles.slice(0, -1), last];
  }
  const price = candles[candles.length - 1].close;
  const P: LearnableParams = { ...DEFAULT_PARAMS, ...(input.params ?? {}) };
  const elliott = withFibToleranceScale(P.fibToleranceScale, () =>
    analyzeElliott(candles, degreesFrom(P.elliottDegrees), { fibWeight: P.rankFibWeight, contextStrength: P.rankContextStrength }),
  );
  const fundamental = analyzeFundamentals(input.fundamentals ?? null, input.news ?? [], input.now, {
    fundamentalWeights: P.fundamentalWeights,
    newsShare: P.newsShare,
    newsHalfLifeHours: P.newsHalfLifeHours,
  });
  const volume = analyzeVolumeRsi(candles, elliott.best, {
    rsiOverbought: P.rsiOverbought,
    rsiOversold: P.rsiOversold,
    divergenceRecentBars: P.divergenceRecentBars,
    relVolHigh: P.relVolHigh,
    relVolBreakout: P.relVolBreakout,
    relVolLow: P.relVolLow,
  });
  // Manuelle Gewichtung (Einstellungen) hat Vorrang, sonst die gelernte (Standard = 60/20/20)
  const weights = input.weights ?? P.weights ?? DEFAULT_WEIGHTS;
  const total = totalScore({ elliott: elliott.score, fundamental: fundamental.score, volume: volume.score }, weights);
  const f = { ...DEFAULT_FILTERS, ...(input.filters ?? {}) };
  const closes = candles.map((c) => c.close);
  const atrNow = atr(candles)[candles.length - 1] ?? price * 0.01;
  if ((input.mode ?? "zone") === "zone") {
    const zone = findZoneSetup(candles.slice(-400), { ...DEFAULT_ZONE_OPTIONS, atrMult: P.zoneAtrMult }); // gleiches Fenster wie im EchoChart gemessen
    const plan: TradePlan | null = zone
      ? {
          direction: zone.direction,
          entry: zone.entry,
          stop: zone.stop,
          targets: zone.targets,
          riskReward: Math.round(zone.riskReward * 100) / 100,
          orderType: zone.inZone ? "market" : "limit",
          zoneStart: zone.zoneStart,
          zoneEnd: zone.zoneEnd,
          cancelAbove: zone.cancelAbove,
          trailDistance: 4 * zone.atr,
        }
      : null;
    const vetoes: string[] = [];
    if (!zone) {
      const e200 = ema(closes, Math.min(200, Math.floor(closes.length * 0.6)))[closes.length - 1];
      const e50 = ema(closes, 50)[closes.length - 1];
      const trend = e200 == null || e50 == null ? 0 : price > e200 && e50 > e200 ? 1 : price < e200 && e50 < e200 ? -1 : 0;
      vetoes.push(trend === 0 ? "Kein klarer übergeordneter Trend" : "Keine Einstiegszone in Reichweite");
    } else if (zone.riskReward < MIN_RISK_REWARD) vetoes.push(`Chance-Risiko ${zone.riskReward.toFixed(2)} unter ${MIN_RISK_REWARD}`);
    // Lernbare Mindest-Signalstärke (Kauf: Score, Short: 100 − Score); Standard 0 = keine Filterung
    if (plan && vetoes.length === 0 && P.minStrength > 0) {
      const strength = plan.direction === "long" ? total : 100 - total;
      if (strength < P.minStrength) vetoes.push(`Signalstärke ${strength.toFixed(0)} unter ${P.minStrength}`);
    }
    // Zusätzliche, lernbare Elliott-Prüfungen – machen Einstiege nur strenger, nie leichter
    if (plan && vetoes.length === 0) vetoes.push(...elliottVetoes(plan.direction === "long" ? 1 : -1, candles, input.interval, elliott, volume, P));
    if (plan && P.wave5Exit) plan.wave5Exit = true;
    const ok = !!plan && vetoes.length === 0;
    const level: SignalDecision["level"] = !ok ? "neutral" : plan!.direction === "long" ? (total >= 72 ? "strong-buy" : "buy") : total <= 28 ? "strong-sell" : "sell";
    const decision: SignalDecision = { level, rawLevel: levelFromScore(total), vetoes };
    const commentary = writeCommentary({
      symbol: input.symbol,
      name: input.name,
      price,
      elliott,
      fundamental,
      volume,
      total,
      decision,
      plan: ok ? plan : null,
      news: input.news ?? [],
      horizonLabel: HORIZON_LABEL[input.horizon],
      kind: input.kind,
      currency: input.currency,
    });
    return { symbol: input.symbol, horizon: input.horizon, interval: input.interval, price, time: candles[candles.length - 1].time, elliott, fundamental, volume, total, weights, decision, plan: ok ? plan : null, commentary, currency: input.currency };
  }
  const plan = buildPlan(elliott.best, price, f.minStopAtr * atrNow);
  const extraVetoes: string[] = [];
  if (plan && f.trend !== "off") {
    const e200 = ema(closes, Math.min(200, Math.floor(closes.length * 0.6)))[closes.length - 1];
    const e50 = ema(closes, 50)[closes.length - 1];
    const dir = plan.direction === "long" ? 1 : -1;
    const trend = e200 == null || e50 == null ? 0 : price > e200 && e50 > e200 ? 1 : price < e200 && e50 < e200 ? -1 : 0;
    if (trend === -dir) extraVetoes.push("Gegen den übergeordneten Trend");
    else if (f.trend === "with" && trend === 0) extraVetoes.push("Kein klarer übergeordneter Trend");
  }
  if (plan && f.confirm) {
    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    const dir = plan.direction === "long" ? 1 : -1;
    if (!((last.close - last.open) * dir > 0 && (last.close - prev.close) * dir > 0)) extraVetoes.push("Noch keine Bestätigung durch den Kurs");
  }
  const decision = decideSignal(total, {
    elliottConfidence: elliott.confidence,
    contested: elliott.contested,
    plan,
    elliottBias: elliott.best?.bias,
    extraVetoes,
  });
  const commentary = writeCommentary({
    symbol: input.symbol,
    name: input.name,
    price,
    elliott,
    fundamental,
    volume,
    total,
    decision,
    plan,
    news: input.news ?? [],
    horizonLabel: HORIZON_LABEL[input.horizon],
    kind: input.kind,
    currency: input.currency,
  });
  return {
    symbol: input.symbol,
    horizon: input.horizon,
    interval: input.interval,
    price,
    time: candles[candles.length - 1].time,
    elliott,
    fundamental,
    volume,
    total,
    weights,
    decision,
    plan,
    commentary,
    currency: input.currency,
  };
}
