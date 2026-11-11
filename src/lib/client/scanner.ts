"use client";
// Chancen-Scanner (geteilt von Übersicht, Chancen und Watchlist): Blacktrader rechnet die Zeiträume im Hintergrund
// und wählt GENAU EINEN aktuellen Einstieg pro Wert (blau / grün / rot / gelb). Shorts nur bei bärischem Gesamtmarkt, Aktien und Krypto ohne
// kurzfristige Signale, Rohstoffe kurzfristig nur bei bullischem Gesamtmarkt (S&P 500).
import { financeCheck } from "../analysis/finance";
import { summarizeHolding } from "./holdings";
import { checkHoldings } from "./holdingWatch";
import { updateChanceLog, type ChanceCandidate } from "./chanceLog";
import { isFxPair } from "./eur";
import { basePotential, BLUE_RULE, MIN_POTENTIAL, passesBlueRule, type PotentialColor } from "../analysis/potential";
import { effectiveWeights, learnedParams, refreshTrainerParams } from "./trainerParams";
import { useMemo, useSyncExternalStore } from "react";
import { analyze, type AnalysisResult } from "../analysis/analyze";
import { findLongTermZone, type LongTermZone } from "../analysis/longterm";
import { HORIZON_RANK, longTermOutcome, marketContext, pickBestEntry, type BestEntry, type HistEntry, type MarketContext } from "../analysis/bestEntry";
import { money } from "../analysis/persona";
import { applyPromotions } from "./promote";
import { refreshFx } from "./fx";
import { assetKey, closeEntry, doneFor, getHistory, recordEntry, type EntryHistory } from "./entries";
import { getData, useAppData } from "../store/store";
import type { Candle, Horizon, ResolvedAsset } from "../types";
import { api } from "./api";
import { inMarket, MARKET_ASSETS } from "./marketList";

export interface HorizonResult {
  res: AnalysisResult;
  candles: Candle[];
}

export interface ScanEntry {
  asset: ResolvedAsset;
  horizons: Partial<Record<Horizon, HorizonResult>>;
  /** Langfristiger Einstiegsbereich (blau), berechnet auf dem langfristigen (sonst mittelfristigen) Zeitraum */
  longterm: LongTermZone | null;
  ltHorizon?: Horizon;
  /** Kerzen, auf denen der Bereich berechnet wurde (zum Einzeichnen) */
  ltCandles?: Candle[];
  /** Der EINE aktuelle Einstieg (blau / grün / gelb) */
  best: BestEntry;
  /** Verlauf: aktueller + alte (graue) Einstiege */
  history: EntryHistory;
  /** Finanz-Prüfung (nur Aktien mit geladenen Firmenzahlen): hohe Schulden und Geld verbrennen/Verluste/Umsatzeinbruch */
  financeWeak?: boolean;
  financeReason?: string;
  /** Tageskerzen (bis ca. 5 Jahre) – alle Charts zeigen Tageskerzen, gerechnet wird weiter auf Tag + Woche */
  daily?: Candle[];
}

export interface ScanState {
  at: number | null;
  entries: ScanEntry[];
  busy: boolean;
  progress: number;
  checked: number;
  failed: number;
  /** Marktlage (S&P 500 / NASDAQ 100) */
  ctx: MarketContext;
}

let state: ScanState = { at: null, entries: [], busy: false, progress: 0, checked: 0, failed: 0, ctx: { spBull: null, techWeak: null } };
const listeners = new Set<() => void>();
const emit = (patch: Partial<ScanState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

/** Aktueller Stand der Suche (außerhalb von React) */
export const getScan = (): ScanState => state;

export function useScan(): ScanState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
}

async function pool<T>(items: T[], limit: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

export function scanAssets(): ResolvedAsset[] {
  const map = new Map<string, ResolvedAsset>();
  const d = getData();
  // Offene Trades mitrechnen (für Hochstufung und nachgezogenen Stop)
  const fromTrades: ResolvedAsset[] = d.trades.filter((t) => t.status !== "closed").map((t) => ({ kind: t.kind, symbol: t.symbol, name: t.name, binanceSymbol: t.binanceSymbol, yahooSymbol: t.yahooSymbol }));
  // Buy & Hold: noch gehaltene eigene Werte (Blacktrader schaut mit und warnt, wenn der große Trend kippt)
  const fromHoldings: ResolvedAsset[] = d.holdings.filter((h) => summarizeHolding(h).qty > 0).map((h) => ({ kind: h.kind, symbol: h.symbol, name: h.name, binanceSymbol: h.binanceSymbol, yahooSymbol: h.yahooSymbol, currency: h.currency, isin: h.isin, exchange: h.exchange }));
  // Markt für die Chancen (rund 190 Werte) + Watchlist (nur für die Watchlist) + offene Trades + Buy & Hold
  for (const a of [...d.watchlist, ...MARKET_ASSETS, ...fromTrades, ...fromHoldings]) if (!map.has(`${a.kind}:${a.symbol}`)) map.set(`${a.kind}:${a.symbol}`, a);
  return [...map.values()];
}

/** Startet die Suche (falls nicht schon aktiv). `maxAgeMs`: vorhandenes Ergebnis wiederverwenden, wenn jünger. */
export async function runScan(maxAgeMs = 15 * 60e3) {
  if (state.busy) return;
  if (state.at && Date.now() - state.at < maxAgeMs) return;
  const { settings } = getData();
  const assets = scanAssets();
  emit({ busy: true, progress: 0 });
  await Promise.race([refreshTrainerParams(), new Promise((r) => setTimeout(r, 3000))]);
  // Wechselkurse zuerst – alle Beträge werden in Euro angezeigt
  const [ctx] = await Promise.all([fetchMarketContext(), Promise.race([refreshFx(), new Promise((r) => setTimeout(r, 4000))])]);
  // Nur die Zeiträume, die ein Signal liefern dürfen oder für den blauen Bereich gebraucht werden
  const horizonsFor = (kind: ResolvedAsset["kind"]): Horizon[] => (["short", "medium", "long"] as Horizon[]).filter((h) => h !== "short" || (kind === "commodity" && ctx.spBull === true && HORIZON_RANK.commodity.includes("short")));
  const jobs = assets.flatMap((asset) => horizonsFor(asset.kind).map((horizon) => ({ asset, horizon })));
  // Watchlist und offene Trades bekommen immer die volle Analyse (mit Firmenzahlen und Nachrichten);
  // Markt-Werte erst, wenn sie zu den aussichtsreichsten gehören (2. Schritt) – so bleibt die Suche schnell.
  const d0 = getData();
  const personal = new Set([...d0.watchlist, ...d0.trades.filter((t) => t.status !== "closed"), ...d0.holdings].map((a) => assetKey(a)));
  const fullAnalysis = async (asset: ResolvedAsset, horizon: Horizon, candles: Candle[]) => {
    const interval = settings.intervals[horizon];
    const [f, n] = await Promise.allSettled([api.fundamentals(asset), api.news(asset)]);
    return analyze({
      symbol: asset.symbol,
      name: asset.name,
      candles,
      horizon,
      interval,
      weights: effectiveWeights(settings, asset.kind, horizon),
      kind: asset.kind,
      currency: asset.currency,
      params: learnedParams(asset.kind, horizon),
      fundamentals: f.status === "fulfilled" ? f.value.fundamentals : null,
      news: n.status === "fulfilled" ? n.value.news : [],
    });
  };
  const byAsset = new Map<string, Omit<ScanEntry, "best" | "history"> & { full: Partial<Record<Horizon, Candle[]>> }>();
  let done = 0;
  let failed = 0;
  // Kursdaten: 12 Abfragen gleichzeitig (vorher 6 – die Suche wartete fast nur auf das Netz; Rechnung unverändert)
  await pool(jobs, 12, async ({ asset: a0, horizon }) => {
    const key = assetKey(a0);
    const entry = byAsset.get(key) ?? { asset: a0, horizons: {}, longterm: null, full: {} };
    byAsset.set(key, entry);
    try {
      const interval = settings.intervals[horizon];
      const { candles, currency } = await api.candles(entry.asset, interval, 60e3);
      // Watchlist-Werte ohne bekannte Währung: aus den Kursdaten übernehmen (sonst stünden $-Preise ohne Umrechnung da)
      if (!entry.asset.currency && currency && !isFxPair(entry.asset)) entry.asset = { ...entry.asset, currency };
      const asset = entry.asset;
      const params = learnedParams(asset.kind, horizon);
      let res = analyze({ symbol: asset.symbol, name: asset.name, candles, horizon, interval, weights: effectiveWeights(settings, asset.kind, horizon), kind: asset.kind, currency: asset.currency, params });
      // Kandidat aus Watchlist/Depot: gleich vollständig bewerten (Firmenzahlen und Nachrichten)
      if (res && res.decision.level !== "neutral" && personal.has(key)) res = (await fullAnalysis(asset, horizon, candles)) ?? res;
      if (res) entry.horizons[horizon] = { res, candles: candles.slice(-150) };
      entry.full[horizon] = candles;
      // Langfristiger Einstieg (blau): NUR auf Wochenkerzen – wie im Turnier und Härtetest getestet
      // (früher ersatzweise auf Tageskerzen; das ergab ungetestete Bereiche, z. B. „Zone in der Zone“ bei Solana)
      if (horizon === "long" && candles.length >= 150) {
        const z = findLongTermZone(candles);
        if (z && z.status !== "invalidiert") {
          entry.longterm = z;
          entry.ltHorizon = horizon;
          entry.ltCandles = candles.slice(-150);
        }
      }
    } catch {
      failed++;
    }
    done++;
    emit({ progress: (0.85 * done) / jobs.length });
  });

  // 2. Schritt: die 40 aussichtsreichsten Markt-Werte mit Firmenzahlen und Nachrichten vollständig bewerten
  const viewsOf = (e: { horizons: ScanEntry["horizons"] }) => Object.fromEntries(Object.entries(e.horizons).map(([h, v]) => [h, v?.res ?? null]));
  const prelim = [...byAsset.values()]
    .filter((e) => inMarket(e.asset) && !personal.has(assetKey(e.asset)))
    .map((e) => {
      const best = pickBestEntry({ symbol: e.asset.symbol, kind: e.asset.kind, views: viewsOf(e), lt: e.longterm, ctx, done: doneFor(assetKey(e.asset)) });
      return { e, p: potential({ ...e, best, history: { past: [] } } as ScanEntry) };
    })
    .filter((x) => x.p != null)
    .sort((a, b) => b.p!.score - a.p!.score)
    .slice(0, 40);
  const enrich = prelim.flatMap(({ e }) => (Object.entries(e.horizons) as [Horizon, HorizonResult][]).filter(([, v]) => v && v.res.decision.level !== "neutral").map(([h]) => ({ e, h })));
  let done2 = 0;
  await pool(enrich, 10, async ({ e, h }) => {
    try {
      const c = e.full[h];
      if (c) {
        const res = await fullAnalysis(e.asset, h, c);
        if (res) e.horizons[h] = { res, candles: c.slice(-150) };
      }
    } catch {
      /* bleibt bei der technischen Bewertung */
    }
    done2++;
    emit({ progress: 0.85 + (0.15 * done2) / Math.max(1, enrich.length) });
  });
  // Finanz-Prüfung für Aktien: die aussichtsreichsten Markt-Werte und alle eigenen (Watchlist, Depot, Buy & Hold)
  const finance = new Map<string, { weak: boolean; reason?: string }>();
  const finAssets = [...new Map([...prelim.map(({ e }) => e.asset), ...[...byAsset.values()].filter((e) => personal.has(assetKey(e.asset))).map((e) => e.asset)].filter((a) => a.kind === "stock").map((a) => [assetKey(a), a])).values()];
  await pool(finAssets, 10, async (a) => {
    try {
      finance.set(assetKey(a), financeCheck((await api.fundamentals(a)).fundamentals));
    } catch {
      /* ohne Firmenzahlen keine Prüfung */
    }
  });

  const entries: ScanEntry[] = [...byAsset.values()].map(({ full, ...e }) => {
    const key = assetKey(e.asset);
    const cur = e.asset.currency;
    // Blauer Bereich schon erledigt (eingetaucht und oben heraus) oder ungültig? → grau, nicht mehr aktuell
    // (Liegt der Schlusskurs gerade wieder IM Bereich, bleibt er aktiv.)
    if (e.longterm) {
      const lc = full[e.ltHorizon ?? "long"] ?? [];
      const nowIn = (lc.at(-1)?.close ?? Infinity) <= e.longterm.zoneTop;
      const o = nowIn ? null : longTermOutcome(e.longterm, lc);
      if (o) closeEntry(key, o.entry, o.status, o.at);
    }
    const candlesOf = (h?: HistEntry) => (!h ? [] : h.color === "blau" ? full[e.ltHorizon ?? "long"] ?? [] : h.horizon ? full[h.horizon] ?? [] : []);
    const pick = () =>
      pickBestEntry({
        symbol: e.asset.symbol,
        kind: e.asset.kind,
        views: Object.fromEntries(Object.entries(e.horizons).map(([h, v]) => [h, v?.res ?? null])),
        lt: e.longterm,
        ctx,
        done: doneFor(key),
        fmt: (n) => money(n, cur),
      });
    let best = pick();
    let history = recordEntry(key, best, candlesOf(getHistory(key).current));
    // Ist der laufende Einstieg gerade erledigt/ungültig geworden, gleich den nächsten wählen
    if (history.current && doneFor(key).has(history.current.key)) {
      best = pick();
      history = recordEntry(key, best, []);
    }
    const fin = finance.get(key);
    return { ...e, best, history, financeWeak: fin?.weak || undefined, financeReason: fin?.reason, daily: full.medium };
  });
  emit({ busy: false, at: Date.now(), entries, checked: jobs.length, failed, ctx });
  try {
    applyPromotions(entries);
  } catch {
    /* Hochstufung beim nächsten Durchlauf */
  }
  try {
    checkHoldings(entries);
  } catch {
    /* beim nächsten Durchlauf */
  }
  try {
    // Live-Bilanz: die Chancen dieser Suche (wie in der Liste: höchstens 20, nach Potenzial) mitschreiben, offene prüfen
    const top = entries
      .filter((e) => isChance(e) && isTopChance(e))
      .map((e) => ({ e, p: potential(e) }))
      .filter((x) => x.p != null)
      .sort((a, b) => b.p!.score - a.p!.score)
      .slice(0, 20)
      .map((x) => x.e);
    const inTop = new Set(top.map((e) => assetKey(e.asset)));
    const cands: ChanceCandidate[] = [];
    for (const e of entries) {
      const b = e.best;
      if (b.color === "gelb" || b.zoneTop == null || b.zoneBottom == null) continue;
      const blue = b.color === "blau";
      const candles = blue ? e.ltCandles ?? [] : b.horizon ? e.horizons[b.horizon]?.candles ?? [] : [];
      const stop = blue ? b.invalidation : b.stop;
      const target = b.targets?.[0];
      if (stop == null || target == null) continue;
      // Neue Einträge nur aus der Chancen-Liste; Kerzen für alle Werte (damit eingetragene weiter geprüft werden)
      cands.push({ key: `${assetKey(e.asset)}|${b.key}${inTop.has(assetKey(e.asset)) ? "" : "|nur-pruefen"}`, symbol: e.asset.symbol, name: e.asset.name, kind: e.asset.kind, color: b.color, dir: b.color === "rot" ? "short" : "long", zoneTop: b.zoneTop, zoneBottom: b.zoneBottom, stop, target, candles });
    }
    updateChanceLog(cands.filter((c) => !c.key.endsWith("|nur-pruefen")), undefined, cands);
  } catch {
    /* Bilanz beim nächsten Durchlauf */
  }
}

/** Marktlage aus den Tageskerzen von S&P 500 und NASDAQ 100 (nur Vergangenheit). */
async function fetchMarketContext(): Promise<MarketContext> {
  const idx = (yahooSymbol: string) => ({ kind: "stock" as const, symbol: yahooSymbol, name: yahooSymbol, yahooSymbol });
  const [sp, nd] = await Promise.allSettled([api.candles(idx("^GSPC"), "1d", 15 * 60e3), api.candles(idx("^NDX"), "1d", 15 * 60e3)]);
  return marketContext(sp.status === "fulfilled" ? sp.value.candles : null, nd.status === "fulfilled" ? nd.value.candles : null);
}

/** Signalart des aktuellen Einstiegs (Chancen-Filter: Alle · Blau · Grün · Rot) */
export type SignalKind = "blau" | "gruen" | "rot";

/** Abstand vom Kurs bis zur Oberkante des Langfrist-Bereichs in % (0 = im Bereich) */
export function longTermDistance(z: LongTermZone, price: number): number {
  return price <= z.zoneTop ? 0 : ((price - z.zoneTop) / price) * 100;
}

/** Abstand vom aktuellen Kurs bis zur Oberkante der Einstiegszone in % (0 = jetzt in der Zone) */
export function bestDistance(e: ScanEntry): number {
  const b = e.best;
  const price = lastPrice(e);
  if (b.zoneTop == null || b.zoneBottom == null || price == null) return 1000;
  // Short: Kurs muss bis zur Unterkante steigen
  if (b.color === "rot") return price >= b.zoneBottom ? 0 : ((b.zoneBottom - price) / price) * 100;
  return price <= b.zoneTop ? 0 : ((price - b.zoneTop) / price) * 100;
}

/** Gehört der Eintrag in die Chancen? (Markt-Werte, nicht reine Watchlist-Werte) */
export const isChance = (e: ScanEntry) => inMarket(e.asset);

/**
 * Potenzial eines Einstiegs (für die Rangliste der Chancen):
 * Chance bis zum Ziel in % (gedeckelt bei 60 %, damit „Mondziele“ nicht alles verdrängen), gewichtet mit
 * Chance/Risiko (gedeckelt bei 4), Signalstärke, Nähe zur Zone und der im Turnier gemessenen Stärke der Signalart.
 */
export function potential(e: ScanEntry): { score: number; base: number; chancePct: number; riskPct: number } | null {
  const b = e.best;
  if (b.color === "gelb" || b.zoneTop == null || b.zoneBottom == null || !b.targets?.length) return null;
  const short = b.color === "rot";
  const entry = short ? b.zoneBottom : b.zoneTop;
  const limit = b.color === "blau" ? b.invalidation : b.stop;
  if (!entry || limit == null) return null;
  const chancePct = (Math.abs(b.targets[0] - entry) / entry) * 100;
  const riskPct = Math.max(0.5, (Math.abs(entry - limit) / entry) * 100);
  const strength = b.res ? (b.res.plan?.direction === "short" ? 100 - b.res.total : b.res.total) : 55;
  const dist = bestDistance(e);
  const near = dist === 0 ? 1 : Math.max(0.25, 1 - dist / 15);
  const base = basePotential(chancePct, riskPct, b.color as PotentialColor);
  return { score: base * (strength / 60) * near, base, chancePct, riskPct };
}

/**
 * Mindestanforderungen für die Chancen – nur die mit der höchsten Chance (höchstens 20, gern weniger):
 *  Grün/Rot: Kurs höchstens 8 % von der Zone (jetzt umsetzbar), Chance bis zum Ziel mindestens 15 %.
 *    Im Turnier geprüft: „Chance ≥ 15 %“ +22,0 % statt +21,8 % pro Jahr. Ein Stop-Limit (≤ 25 %) schadete stark
 *    (+6,8 %) – die besten Trades sind große Wellen mit weitem Stop –, darum gibt es keins.
 *  Blau: Kurs schon im Bereich, Ungültig-Grenze höchstens 40 % entfernt, Chance mindestens 40 %.
 *  Grün/Rot: Potenzial-Grundwert mindestens MIN_POTENTIAL (obere Hälfte, siehe analysis/potential.ts) – wie im Turnier.
 */
export const CHANCE_RULES = {
  trade: { maxDistancePct: 8 },
  blau: { maxRiskPct: BLUE_RULE.maxRiskPct, minChancePct: BLUE_RULE.minChancePct },
  minChancePct: 15,
} as const;

/** Erfüllt der Einstieg die Mindestanforderungen für die Chancen? */
export function isTopChance(e: ScanEntry): boolean {
  // Finanz-Prüfung: hoch verschuldet und Geld verbrennen/Verluste/Umsatzeinbruch → nicht in die Chancen
  if (e.financeWeak) return false;
  const p = potential(e);
  if (!p || p.chancePct < CHANCE_RULES.minChancePct) return false;
  const b = e.best;
  // Potenzial-Grenze nur für Grün/Rot – Blau hat dafür die Blau-Regel (sonst fiele jeder blaue Einstieg heraus)
  if (b.color !== "blau" && p.base < MIN_POTENTIAL) return false;
  const d = bestDistance(e);
  if (b.color === "blau") return d === 0 && passesBlueRule(p.chancePct, p.riskPct);
  return d <= CHANCE_RULES.trade.maxDistancePct;
}


/** Letzter bekannter Kurs eines Eintrags */
export function lastPrice(e: ScanEntry): number | undefined {
  for (const h of ["short", "medium", "long"] as Horizon[]) if (e.horizons[h]) return e.horizons[h]!.res.price;
  return e.ltCandles?.at(-1)?.close;
}

/** Abstand vom aktuellen Kurs bis zum Einstieg in % (0 = jetzt in der Zone) */
export function entryDistance(res: AnalysisResult): number {
  const p = res.plan;
  if (!p || p.orderType !== "limit") return 0;
  return (Math.abs(res.price - p.entry) / res.price) * 100;
}

/** Werte, die offen im Blacktrader-Depot liegen (Art:Symbol) – erscheinen nicht mehr in Chancen/Top 3.
 *  Die Live-Bilanz läuft im Hintergrund unverändert weiter (sie wird in runScan vor dieser Anzeige-Filterung erfasst). */
export function useHeldKeys(): Set<string> {
  const trades = useAppData((d) => d.trades);
  return useMemo(() => new Set(trades.filter((t) => t.status !== "closed").map((t) => `${t.kind}:${t.symbol}`)), [trades]);
}
export const notHeld = (held: Set<string>) => (e: ScanEntry) => !held.has(`${e.asset.kind}:${e.asset.symbol}`);
