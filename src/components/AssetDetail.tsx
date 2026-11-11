"use client";
// Detailansicht eines Werts (als Bottom-Sheet oder eigene Seite): großer Chart mit Wellenzählung und
// Fibo-Zonen, Signal mit Teil-Scores, Langfristiger Einstieg, Begründung, Fundamentalzahlen, News.
import { displayCurrency } from "@/lib/client/eur";
import { useGermanQuote } from "@/lib/client/germanQuote";
import { effectiveWeights, learnedParams, useTrainerVersion } from "@/lib/client/trainerParams";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { analyze } from "@/lib/analysis/analyze";
import { findLongTermZone } from "@/lib/analysis/longterm";
import { INTERVAL_SECONDS, snapCount } from "@/lib/analysis/snapPivots";
import { openLongTerm, openLongTermTrade } from "@/lib/client/longterm";
import { money } from "@/lib/analysis/persona";
import { api } from "@/lib/client/api";
import { binanceStream } from "@/lib/client/binanceWs";
import { useLive } from "@/lib/client/market";
import { SCAN_PRESETS } from "@/lib/client/presets";
import { useScan } from "@/lib/client/scanner";
import { actions, useAppData } from "@/lib/store/store";
import { type Candle, type Fundamentals, type Horizon, type Interval, type NewsItem, type ResolvedAsset } from "@/lib/types";
import { Commentary, LongTermCard, LongTermSignalCard, FundamentalsPanel, NewsPanel, SignalCard, VolumePanel, WavePanel } from "./AnalysisPanels";
import type { ChartEntry } from "./chartZones";
import { PriceChart } from "./PriceChart";
import { StatusPill } from "./StatusPill";
import { TradeDialog } from "./TradeDialog";

/** Ohne bekannte Währung: Symbol ohne Börsen-Endung = US-Börse (Dollar) */
const analysisCurrencyGuess = (a: { kind: string; symbol: string; yahooSymbol?: string }) => (a.kind === "stock" && !/[.=^]/.test(a.yahooSymbol ?? a.symbol) ? "USD" : undefined);

type DetailAsset = ResolvedAsset & { id?: string };
/**
 * Kein Zeitraum-Umschalter mehr: Blacktrader zeigt den Zeitraum des aktuellen Einstiegs
 * (Aktien und Krypto nie kurzfristig).
 */
/** `hideTake`: oben steht schon die Kachel mit „übernehmen“ – unten keinen zweiten Knopf zeigen */
export function AssetDetailView({ asset, initialHorizon, hideTake = false }: { asset: DetailAsset; initialHorizon?: Horizon; hideTake?: boolean }) {
  const settings = useAppData((d) => d.settings);
  const live = useLive(asset);
  const scan = useScan();
  const best = scan.entries.find((e) => e.asset.kind === asset.kind && e.asset.symbol === asset.symbol);
  const wanted = initialHorizon ?? best?.best.horizon ?? best?.ltHorizon ?? "medium";
  const horizon: Horizon = wanted === "short" && asset.kind !== "commodity" ? "medium" : wanted;
  const interval: Interval = settings.intervals[horizon];
  const [candles, setCandles] = useState<Candle[]>([]);
  const [source, setSource] = useState("");
  const [fundamentals, setFundamentals] = useState<Fundamentals | null>(null);
  const [fundNote, setFundNote] = useState<string | undefined>();
  const [news, setNews] = useState<NewsItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [trade, setTrade] = useState(false);

  // Kerzen laden + periodisch aktualisieren
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await api.candles(asset, interval, 15e3);
        if (cancelled) return;
        setCandles(r.candles);
        setSource(r.source);
        setError(null);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    setLoading(true);
    load();
    const t = setInterval(load, interval === "5m" || interval === "15m" ? 60e3 : 300e3);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [asset.symbol, asset.kind, interval]); // eslint-disable-line react-hooks/exhaustive-deps

  // Anzeige immer in Tageskerzen (gerechnet wird weiter auf den Kerzen des Zeitraums, z. B. Woche)
  // Tageskerzen aus der Suche sofort nutzen (kein Warten), danach frisch laden
  const [dayRaw, setDayRaw] = useState<Candle[]>(() => best?.daily ?? []);
  useEffect(() => {
    if (interval === "1d") return;
    let cancelled = false;
    const load = () =>
      api
        .candles(asset, "1d", 60e3)
        .then((r) => !cancelled && setDayRaw(r.candles))
        .catch(() => {});
    load();
    const t = setInterval(load, 300e3);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [asset.symbol, asset.kind, interval]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live-Kerze (Binance)
  useEffect(() => {
    if (!asset.binanceSymbol || !binanceStream || source !== "Binance") return;
    return binanceStream.subscribe(`${asset.binanceSymbol}@kline_${interval}`, (m) => {
      const k = m.k as { t: number; o: string; h: string; l: string; c: string; v: string };
      const c: Candle = { time: Math.floor(k.t / 1000), open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.v };
      setCandles((prev) => {
        if (!prev.length) return prev;
        const last = prev[prev.length - 1];
        if (c.time === last.time) return [...prev.slice(0, -1), c];
        if (c.time > last.time) return [...prev, c];
        return prev;
      });
    });
  }, [asset.binanceSymbol, interval, source]);

  useEffect(() => {
    api
      .fundamentals(asset)
      .then((r) => {
        setFundamentals(r.fundamentals);
        setFundNote(r.note);
      })
      .catch((e) => {
        setFundamentals(null);
        setFundNote((e as Error).message);
      });
    api.news(asset).then((r) => setNews(r.news)).catch(() => setNews([]));
  }, [asset.symbol, asset.kind]); // eslint-disable-line react-hooks/exhaustive-deps

  const chartCandles = useMemo(() => {
    if (!live?.price || candles.length === 0 || source === "Binance") return candles;
    const last = candles[candles.length - 1];
    if (Math.abs(live.price - last.close) / last.close > 0.2) return candles;
    return [...candles.slice(0, -1), { ...last, close: live.price, high: Math.max(last.high, live.price), low: Math.min(last.low, live.price) }];
  }, [candles, live?.price, source]);

  // Blau nur aus Wochenkerzen (wie getestet)
  const ltZone = useMemo(() => (interval === "1w" && candles.length >= 150 ? findLongTermZone(candles) : null), [candles, interval]);
  const myLt = useAppData((d) => d.trades.find((t) => t.strategy === "longterm" && t.status !== "closed" && t.symbol === asset.symbol));
  // Alle offenen Käufe dieses Werts (Zentraldepot, 2. Kauf …) – im Chart: neuester blau, ältere grau
  const allTrades = useAppData((d) => d.trades);
  const buys = useMemo(() => allTrades.filter((t) => t.strategy === "longterm" && t.status !== "closed" && t.symbol === asset.symbol && t.lt).sort((a, b) => a.openedAt - b.openedAt), [allTrades, asset.symbol]);
  const currency = displayCurrency(asset, live?.currency ?? asset.currency);
  const deQuote = useGermanQuote(asset, live?.currency ?? asset.currency ?? analysisCurrencyGuess(asset));
  const trainerV = useTrainerVersion();
  const analysis = useMemo(
    () =>
      chartCandles.length >= 30
        ? analyze({ symbol: asset.symbol, name: asset.name, candles: chartCandles, horizon, interval, fundamentals, news, weights: effectiveWeights(settings, asset.kind, horizon), kind: asset.kind, currency, params: learnedParams(asset.kind, horizon) })
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [asset.symbol, asset.name, asset.kind, chartCandles, horizon, interval, fundamentals, news, settings.weights, settings.weightsMode, currency, trainerV],
  );

  // Einstiege für den Chart: aktueller Einstieg von Blacktrader (blau/grün) und alte (grau)
  const chartEntries = useMemo((): ChartEntry[] => {
    const out: ChartEntry[] = [];
    const fmtD = (t: number) => new Date(t * 1000).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" });
    const STATUS = { erledigt: "erledigt", ungültig: "ungültig", abgelöst: "abgelöst" } as const;
    const near = (a: number, b: number) => Math.abs(a - b) / Math.max(1e-9, Math.abs(b)) < 0.005;
    const bought = (top: number, bottom: number) => buys.some((t) => near(t.lt!.zoneTop, top) && near(t.lt!.zoneBottom, bottom));
    for (const p of (best?.history.past ?? []).slice(0, 10))
      if (p.zoneTop != null && p.zoneBottom != null && !bought(p.zoneTop, p.zoneBottom)) out.push({ color: "grau", from: p.from, to: p.to, top: p.zoneTop, bottom: p.zoneBottom, label: `${p.status ? STATUS[p.status] : "alt"} ${p.to ? fmtD(p.to) : ""}`.trim() });
    // Deine Käufe: neuester blau, ältere grau (bis zum nächsten Kauf)
    buys.forEach((t, k) => {
      const latest = k === buys.length - 1;
      const name = k === 0 ? "Zentraldepot" : `${k + 1}. Kauf`;
      // Bereich ab seiner Entstehung (Hoch der Welle 1); ältere Käufe grau bis heute (Position ist noch offen)
      const from = t.lt!.highTime ?? Math.floor(t.openedAt / 1000) - 60 * 86400;
      out.push({ color: latest ? "blau" : "grau", from, top: t.lt!.zoneTop, bottom: t.lt!.zoneBottom, invalidation: latest ? t.lt!.invalidation : undefined, target: latest ? t.lt!.targets[0] : undefined, label: name });
    });
    const b = best?.best;
    const lastT = chartCandles[chartCandles.length - 1]?.time ?? 0;
    if ((b?.color === "gruen" || b?.color === "rot") && b.zoneTop != null && b.zoneBottom != null) {
      const piv = b.res?.elliott.best?.pivots;
      const from = piv?.length ? piv[piv.length - 1].time : chartCandles[Math.max(0, chartCandles.length - 20)]?.time ?? lastT;
      out.push({ color: b.color, from, top: b.zoneTop, bottom: b.zoneBottom, stop: b.stop, target: b.targets?.[0], label: b.color === "rot" ? "Short-Zone" : "Zielzone" });
    } else if (b?.color === "blau" && b.lt) {
      // schon gekaufter Bereich steht oben als dein Kauf; ein neuer Bereich = Nachkauf möglich
      if (!buys.some((t) => t.lt!.key === b.lt!.key) && !bought(b.lt.zoneTop, b.lt.zoneBottom))
        out.push({ color: "blau", from: b.lt.high.time, top: b.lt.zoneTop, bottom: b.lt.zoneBottom, invalidation: b.lt.invalidation, target: b.lt.targets[0], label: buys.length ? "Neuer Bereich – Nachkauf möglich" : "Langfrist-Einstieg (3 Teile)" });
    } else if (!best) {
      // Ohne Blacktrader-Suche: Einstieg aus der Analyse dieses Charts
      const p = analysis?.plan;
      if (p && analysis?.decision.level !== "neutral") {
        const top = Math.max(p.zoneStart ?? p.entry, p.zoneEnd ?? p.entry);
        const bottom = Math.min(p.zoneStart ?? p.entry, p.zoneEnd ?? p.entry);
        const piv = analysis?.elliott.best?.pivots;
        out.push({ color: p.direction === "short" ? "rot" : "gruen", from: piv?.length ? piv[piv.length - 1].time : lastT, top, bottom, stop: p.stop, target: p.targets[0], label: p.direction === "short" ? "Short-Zone" : "Zielzone" });
      } else if (ltZone && ltZone.status !== "invalidiert") {
        out.push({ color: "blau", from: ltZone.high.time, top: ltZone.zoneTop, bottom: ltZone.zoneBottom, invalidation: ltZone.invalidation, target: ltZone.targets[0], label: "Langfrist-Einstieg (3 Teile)" });
      }
    }
    return out;
  }, [best, chartCandles, analysis, ltZone, buys]);
  // Anzeige: Tageskerzen (mit Live-Kurs); Wellenpunkte und Zonen-Beginn auf die passende Tageskerze legen
  const dayCandles = useMemo(() => {
    if (interval === "1d") return chartCandles;
    if (!dayRaw.length) return [];
    const last = dayRaw[dayRaw.length - 1];
    if (!live?.price || Math.abs(live.price - last.close) / last.close > 0.2) return dayRaw;
    return [...dayRaw.slice(0, -1), { ...last, close: live.price, high: Math.max(last.high, live.price), low: Math.min(last.low, live.price) }];
  }, [interval, chartCandles, dayRaw, live?.price]);
  const span = INTERVAL_SECONDS[interval] ?? 86400;
  const shownBest = useMemo(() => snapCount(analysis?.elliott.best, dayCandles, span), [analysis, dayCandles, span]);
  const shownAlt = useMemo(() => snapCount(analysis?.elliott.alternative, dayCandles, span), [analysis, dayCandles, span]);
  const shownEntries = useMemo(() => {
    if (!dayCandles.length || interval === "1d") return chartEntries;
    const at = (t: number) => {
      const i = dayCandles.findIndex((c) => c.time >= t);
      return i < 0 ? dayCandles[dayCandles.length - 1].time : dayCandles[i].time;
    };
    return chartEntries.map((e) => ({ ...e, from: at(e.from), to: e.to != null ? at(e.to) : e.to }));
  }, [chartEntries, dayCandles, interval]);

  // Nur das Hauptszenario zeigen: ist der aktuelle Einstieg blau (langfristig), keinen grünen Trade-Plan darunter –
  // und umgekehrt. Ohne Scan-Ergebnis bleibt alles sichtbar.
  const mainColor = best?.best.color;
  const showTradePlan = mainColor !== "blau";
  const showLongTerm = mainColor == null || mainColor === "blau";
  const fmtPrice = useMemo(() => (n: number) => money(n, currency), [currency]);

  return (
    <div className="space-y-4">
      <div className="ls-hide flex items-start justify-between gap-3">
        <div>
          <div className="text-[13px] text-stone-400">
            {asset.symbol}
            {asset.isin ? ` · ${asset.isin}` : ""}
            {asset.exchange ? ` · ${asset.exchange}` : ""}
          </div>
          <div className="num text-[24px] font-semibold text-stone-50">{live?.price != null ? money(live.price, currency) : analysis ? money(analysis.price, currency) : "–"}</div>
          {deQuote && (
            <div className="text-[13px] text-stone-400">
              In Deutschland (Xetra, {deQuote.symbol}): <span className="num text-stone-200">{money(deQuote.price, "EUR")}</span>
            </div>
          )}
          <div className="flex items-center gap-2">
            {live?.changePct != null && <span className={`num text-[15px] ${live.changePct >= 0 ? "text-up" : "text-down"}`}>{`${live.changePct >= 0 ? "+" : ""}${live.changePct.toFixed(2).replace(".", ",")} %`}</span>}
            {/* Werte außerhalb von Watchlist/Depot haben keinen Live-Kurs – dann Status der geladenen Kerzen statt ewig „Lädt“ */}
            <StatusPill status={live?.status ?? (candles.length ? (source === "Binance" ? "live" : "delayed") : undefined)} source={live?.source ?? source} />
          </div>
        </div>
      </div>

      <label className="ls-hide flex min-h-[44px] items-center justify-between gap-3 rounded-xl bg-white/5 px-3 text-[15px] text-stone-200">
        <span>
          Expertenansicht
          <span className="block text-[13px] text-stone-400">Wellen-Labels, Alternativzählung, Fibonacci, Teil-Scores</span>
        </span>
        <input type="checkbox" className="h-6 w-6 accent-[#C9A24A]" checked={settings.expertMode} onChange={(e) => actions.setSettings({ expertMode: e.target.checked })} />
      </label>
      <p className="ls-hide text-[13px] text-stone-400">Chart in Tageskerzen.</p>

      <div className="card chart-wrap overflow-hidden p-1">
        {error && <p className="p-3 text-[15px] text-red-300">Kursdaten nicht verfügbar: {error}</p>}
        {(loading || !dayCandles.length) && !error && <p className="p-3 text-[15px] text-stone-400">Lade Kerzen …</p>}
        {dayCandles.length > 0 && (
          <PriceChart
            candles={dayCandles}
            best={shownBest}
            alternative={shownAlt}
            plan={showTradePlan && (settings.expertMode || analysis?.decision.level !== "neutral") ? analysis?.plan : null}
            showAlternative={settings.expertMode}
            simple={!settings.expertMode}
            height={typeof window !== "undefined" && window.matchMedia("(orientation: landscape) and (max-height: 500px)").matches ? Math.max(240, window.innerHeight - 110) : 360}
            entries={shownEntries}
            fmt={fmtPrice}
            currency={currency}
          />
        )}
      </div>

      {analysis ? (
        <>
          {showTradePlan && <SignalCard a={analysis} onTrade={hideTake ? undefined : () => setTrade(true)} shortAllowed={scan.ctx.spBear === true} main={mainColor === "gruen" || mainColor === "rot" || mainColor === "gelb" ? mainColor : undefined} />}
          {!showTradePlan && <LongTermSignalCard a={analysis} zone={ltZone} currency={currency} />}
          {/* Schon investiert (offene Langfrist-Position) → kein „Langfristiger Einstieg“ mehr anbieten (Wunsch des Nutzers) */}
          {showLongTerm && !myLt && !openLongTerm(asset.symbol) && <LongTermCard
            zone={ltZone}
            currency={currency}
            position={null}
            onTake={!hideTake && ltZone ? () => openLongTermTrade({ ...asset, currency: asset.currency ?? currency }, ltZone, horizon, interval, chartCandles[chartCandles.length - 1]?.close ?? ltZone.zoneTop) : undefined}
          />}
          {showTradePlan && <Commentary a={analysis} item={asset} />}
          <FundamentalsPanel a={analysis} f={fundamentals} note={fundNote} kind={asset.kind} />
          <NewsPanel news={news} score={analysis.fundamental.newsScore} />
          <details className="card p-4" open={settings.expertMode}>
            <summary className="cursor-pointer text-[15px] font-medium text-gold-light">Wellenzählung im Detail</summary>
            <div className="mt-3">
              <WavePanel a={analysis} />
            </div>
          </details>
          <details className="card p-4" open={settings.expertMode}>
            <summary className="cursor-pointer text-[15px] font-medium text-gold-light">Volumen & RSI im Detail</summary>
            <div className="mt-3">
              <VolumePanel a={analysis} />
            </div>
          </details>
        </>
      ) : (
        <div className="card p-4 text-[15px] text-stone-400">{candles.length > 0 && candles.length < 30 ? "Zu wenig Historie für eine Analyse." : "Analyse wird berechnet …"}</div>
      )}
      {trade && analysis && <TradeDialog item={{ ...asset, currency: asset.currency ?? currency, id: asset.id ?? "detail", addedAt: 0 }} analysis={analysis} onClose={() => setTrade(false)} />}
    </div>
  );
}

/** Eigene Seite /analyse?id=… (Watchlist) bzw. ?sym=…&kind=… (Chancen) – z. B. für Links aus Benachrichtigungen. */
export function AssetDetail() {
  const params = useSearchParams();
  const id = params.get("id");
  const sym = params.get("sym");
  const kind = params.get("kind");
  const watch = useAppData((d) => d.watchlist);
  const trades = useAppData((d) => d.trades);
  // Depot: Werte liegen nicht mehr in der Watchlist – Angaben aus dem Trade nehmen
  const held = [...trades].reverse().find((t) => t.symbol === sym && t.kind === kind);
  const fromTrade = held ? { kind: held.kind, symbol: held.symbol, name: held.name, binanceSymbol: held.binanceSymbol, yahooSymbol: held.yahooSymbol, currency: held.currency } : undefined;
  const asset = (id ? watch.find((w) => w.id === id) : undefined) ?? watch.find((w) => w.symbol === sym && w.kind === kind) ?? SCAN_PRESETS.find((p) => p.symbol === sym && p.kind === kind) ?? fromTrade;
  if (!asset) return <div className="card p-6 text-[15px] text-stone-400">Wert nicht gefunden.</div>;
  return (
    <div className="space-y-3">
      <h1 className="text-[22px] text-gold">{asset.name}</h1>
      <AssetDetailView asset={asset} initialHorizon={"horizon" in asset ? (asset as { horizon?: Horizon }).horizon : undefined} />
    </div>
  );
}
