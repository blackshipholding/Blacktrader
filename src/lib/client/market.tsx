"use client";
// Zentrale Echtzeit-Überwachung: Live-Kurse (Binance-WebSocket bzw. Polling), Analysen der Watchlist,
// Signal-Alarme und automatische Verfolgung offener Papier-Trades.
import { checkWatchZones } from "./zoneAlert";
import { startAutoBackup } from "./autoBackup";
import { brokerStop } from "./brokerStop";
import { exhaustionAt, rsi } from "../analysis/indicators";
import { resumeTraining } from "./trainingSession";
import { syncPush } from "./push";
import { effectiveWeights, learnedParams, refreshTrainerParams, trainerVersion } from "./trainerParams";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { analyze, type AnalysisResult } from "../analysis/analyze";
import { SIGNAL_LABEL } from "../analysis/score";
import { tradeReturnPct } from "../analysis/stats";
import { fmtPrice, money } from "../analysis/persona";
import { tradeCurrency, tradeReturnEur } from "./eur";
import { eurPerUnit, onFx } from "../fx";
import { refreshFx } from "./fx";
import { actions, getData, useAppData, type Trade, type WatchItem } from "../store/store";
import type { Candle, Fundamentals, Horizon, Interval, NewsItem, ResolvedAsset } from "../types";
import { notify } from "./alerts";
import { findLongTermZone, type LongTermZone } from "../analysis/longterm";
import { backfillShares, checkLongTermWithCandles, trackLongTerm } from "./longterm";
import { api } from "./api";
import { binanceStream } from "./binanceWs";

export type LiveStatus = "live" | "delayed" | "offline" | "loading";

export interface LiveState {
  price?: number;
  changePct?: number;
  currency?: string;
  time?: number;
  status: LiveStatus;
  source?: string;
  error?: string;
  updated?: number;
}

export interface ItemAnalysis {
  horizon: Horizon;
  interval: Interval;
  result: AnalysisResult | null;
  candles: Candle[];
  fundamentals: Fundamentals | null;
  news: NewsItem[];
  candleSource?: string;
  error?: string;
  loading: boolean;
  /** Langfristiger Einstiegsbereich auf den Kerzen dieses Werts */
  longterm?: LongTermZone | null;
}

type Instrument = Pick<ResolvedAsset, "kind" | "symbol" | "name" | "binanceSymbol" | "yahooSymbol" | "coingeckoId">;

export const instrumentKey = (a: Pick<ResolvedAsset, "kind" | "symbol">) => `${a.kind}:${a.symbol}`;

interface Ctx {
  live: Record<string, LiveState>;
  analyses: Record<string, ItemAnalysis>;
  refresh: (id?: string) => void;
}

const MarketContext = createContext<Ctx>({ live: {}, analyses: {}, refresh: () => {} });

export const useMarket = () => useContext(MarketContext);
export const useLive = (a?: Pick<ResolvedAsset, "kind" | "symbol">) => useContext(MarketContext).live[a ? instrumentKey(a) : ""] as LiveState | undefined;

const candleRefreshMs = (iv: Interval) => (iv === "5m" ? 60e3 : iv === "15m" ? 120e3 : iv === "1h" ? 300e3 : iv === "4h" ? 600e3 : 1800e3);

export function itemHorizon(item: WatchItem, global: Horizon): Horizon {
  return item.horizon ?? global;
}

export function MarketProvider({ children }: { children: ReactNode }) {
  const watchlist = useAppData((d) => d.watchlist);
  const openTrades = useAppData((d) => d.trades.filter((t) => t.status !== "closed"));
  const settings = useAppData((d) => d.settings);
  const [live, setLive] = useState<Record<string, LiveState>>({});
  const [analyses, setAnalyses] = useState<Record<string, ItemAnalysis>>({});
  const [reloadTick, setReloadTick] = useState(0);
  const liveRef = useRef(live);
  liveRef.current = live;

  // Alle zu überwachenden Instrumente: Watchlist + offene Trades
  const instruments = useMemo(() => {
    const map = new Map<string, Instrument>();
    for (const w of watchlist) map.set(instrumentKey(w), w);
    for (const t of openTrades) if (!map.has(instrumentKey(t))) map.set(instrumentKey(t), { kind: t.kind, symbol: t.symbol, name: t.name, binanceSymbol: t.binanceSymbol, yahooSymbol: t.yahooSymbol });
    return [...map.values()];
  }, [watchlist, openTrades]);
  const instrumentsKey = instruments.map((i) => `${instrumentKey(i)}|${i.binanceSymbol ?? ""}|${i.yahooSymbol ?? ""}`).join(",");

  // ---- Live-Kurse
  // Push-Abo mit offenen Trades und Watchlist aktuell halten
  const tradesForPush = useAppData((d) => d.trades);
  useEffect(() => {
    syncPush();
  }, [tradesForPush, watchlist]);

  // Werte im Depot gehören nicht mehr in die Watchlist (ältere Daten einmal bereinigen)
  useEffect(() => {
    actions.pruneWatchHeld();
    backfillShares();
  }, []);

  // Langfrist-Positionen alle 15 Minuten mit ihren eigenen Kerzen prüfen (Wellenzählung, Invalidierung)
  useEffect(() => {
    const run = async () => {
      const d = getData();
      for (const t of d.trades) {
        if (t.strategy !== "longterm" || t.status === "closed") continue;
        try {
          const r = await api.candles(t, t.interval, 10 * 60e3);
          const msg = checkLongTermWithCandles(getData().trades.find((x) => x.id === t.id) ?? t, r.candles);
          if (msg) notify(`Langfristig ${t.symbol}`, msg, { sound: d.settings.sound, notifications: d.settings.notifications, kind: "info" });
        } catch {
          /* nächster Versuch */
        }
      }
    };
    const first = setTimeout(run, 8000);
    const timer = setInterval(run, 15 * 60e3);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);

  // Wechselkurse (Euro-Anzeige) beim Start und alle 30 Minuten
  const [, setFxTick] = useState(0);
  useEffect(() => {
    const off = onFx(() => setFxTick((x) => x + 1));
    void refreshFx();
    const t = setInterval(() => void refreshFx(), 30 * 60e3);
    return () => {
      off();
      clearInterval(t);
    };
  }, []);

  useEffect(() => startAutoBackup(), []);

  useEffect(() => {
    void refreshTrainerParams();
    resumeTraining(); // laufende Trainingssitzung nach dem Neuladen fortsetzen
  }, []);

  useEffect(() => {
    const cleanups: (() => void)[] = [];
    const pollMs = settings.pollSeconds * 1000;
    const set = (key: string, patch: Partial<LiveState>) =>
      setLive((prev) => ({ ...prev, [key]: { ...(prev[key] ?? { status: "loading" }), ...patch } }));

    for (const inst of instruments) {
      const key = instrumentKey(inst);
      let lastWs = 0;
      const poll = async () => {
        // Bei aktivem WebSocket kein Polling nötig
        if (inst.binanceSymbol && Date.now() - lastWs < 30e3) return;
        try {
          const q = await api.quote(inst);
          set(key, { price: q.price, changePct: q.changePct, currency: q.currency, time: q.time, status: q.delayed ? "delayed" : "live", source: q.source, error: undefined, updated: Date.now() });
        } catch (e) {
          const prev = liveRef.current[key];
          const stale = !prev?.updated || Date.now() - prev.updated > pollMs * 3;
          set(key, { status: stale ? "offline" : prev?.status ?? "offline", error: (e as Error).message });
        }
      };
      poll();
      const t = setInterval(poll, inst.binanceSymbol ? Math.max(pollMs, 20e3) : pollMs);
      cleanups.push(() => clearInterval(t));
      if (inst.binanceSymbol && binanceStream) {
        cleanups.push(
          binanceStream.subscribe(`${inst.binanceSymbol}@miniTicker`, (m) => {
            lastWs = Date.now();
            const c = Number(m.c);
            const o = Number(m.o);
            set(key, { price: c, changePct: o ? ((c - o) / o) * 100 : 0, currency: "USDT", time: Math.floor(Number(m.E) / 1000), status: "live", source: "Binance WebSocket", error: undefined, updated: Date.now() });
          }),
        );
      }
    }
    // Veraltete Werte als offline markieren
    const staleTimer = setInterval(() => {
      const now = Date.now();
      setLive((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const [k, v] of Object.entries(prev)) {
          if (v.updated && now - v.updated > Math.max(pollMs * 3, 90e3) && v.status !== "offline") {
            next[k] = { ...v, status: "offline" };
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 15e3);
    cleanups.push(() => clearInterval(staleTimer));
    return () => cleanups.forEach((c) => c());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instrumentsKey, settings.pollSeconds]);

  // ---- Rohdaten für Analysen (Kerzen, Fundamentaldaten, News)
  const raw = useRef<Record<string, { candles: Candle[]; fundamentals: Fundamentals | null; news: NewsItem[]; source?: string; error?: string; version: number; horizon: Horizon; interval: Interval; longterm?: LongTermZone | null }>>({});
  const [dataVersion, setDataVersion] = useState(0);
  const watchKey = watchlist.map((w) => `${w.id}:${itemHorizon(w, settings.globalHorizon)}:${settings.intervals[itemHorizon(w, settings.globalHorizon)]}`).join(",");

  useEffect(() => {
    const timers: ReturnType<typeof setInterval>[] = [];
    let cancelled = false;
    const ids = new Set(watchlist.map((w) => w.id));
    for (const k of Object.keys(raw.current)) if (!ids.has(k)) delete raw.current[k];
    setAnalyses((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => ids.has(k))));

    for (const item of watchlist) {
      const horizon = itemHorizon(item, settings.globalHorizon);
      const interval = settings.intervals[horizon];
      const loadCandles = async () => {
        try {
          const r = await api.candles(item, interval, candleRefreshMs(interval) / 2);
          if (cancelled) return;
          raw.current[item.id] = { ...(raw.current[item.id] ?? { fundamentals: null, news: [] }), candles: r.candles, source: r.source, error: undefined, version: Date.now(), horizon, interval, longterm: interval === "1w" && r.candles.length >= 150 ? findLongTermZone(r.candles) : null };
        } catch (e) {
          if (cancelled) return;
          raw.current[item.id] = { ...(raw.current[item.id] ?? { fundamentals: null, news: [], candles: [] }), error: (e as Error).message, version: Date.now(), horizon, interval } as never;
        }
        setDataVersion((v) => v + 1);
      };
      const loadExtras = async () => {
        const [f, n] = await Promise.allSettled([api.fundamentals(item), api.news(item)]);
        if (cancelled) return;
        const cur = raw.current[item.id] ?? { candles: [], version: 0, horizon, interval, fundamentals: null, news: [] };
        raw.current[item.id] = {
          ...cur,
          fundamentals: f.status === "fulfilled" ? f.value.fundamentals : cur.fundamentals,
          news: n.status === "fulfilled" ? n.value.news : cur.news,
          version: Date.now(),
        };
        setDataVersion((v) => v + 1);
      };
      setAnalyses((prev) => ({ ...prev, [item.id]: { ...(prev[item.id] ?? { result: null, candles: [], fundamentals: null, news: [] }), horizon, interval, loading: true } }));
      loadCandles();
      loadExtras();
      timers.push(setInterval(loadCandles, candleRefreshMs(interval)));
      timers.push(setInterval(loadExtras, 20 * 60e3));
    }
    return () => {
      cancelled = true;
      timers.forEach(clearInterval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchKey, reloadTick]);

  // ---- Analyse-Takt: berechnet bei neuen Daten/Kursen neu (max. alle 5 s), Alarme + Trade-Verfolgung
  const lastCalc = useRef<Record<string, { version: number; price?: number; at: number; tv?: number }>>({});
  useEffect(() => {
    const run = () => {
      const d = getData();
      const next: Record<string, ItemAnalysis> = {};
      for (const item of d.watchlist) {
        const r = raw.current[item.id];
        if (!r) continue;
        const lv = liveRef.current[instrumentKey(item)];
        const prev = lastCalc.current[item.id];
        const priceMoved = lv?.price && prev?.price ? Math.abs(lv.price - prev.price) / prev.price > 0.0005 : lv?.price !== prev?.price;
        if (prev && prev.version === r.version && prev.tv === trainerVersion() && !priceMoved) continue;
        if (prev && Date.now() - prev.at < 5000 && prev.version === r.version) continue;
        lastCalc.current[item.id] = { version: r.version, price: lv?.price, at: Date.now(), tv: trainerVersion() };
        const result =
          r.candles.length >= 30
            ? analyze({ symbol: item.symbol, name: item.name, candles: r.candles, horizon: r.horizon, interval: r.interval, fundamentals: r.fundamentals, news: r.news, weights: effectiveWeights(d.settings, item.kind, r.horizon), livePrice: lv?.price, kind: item.kind, currency: lv?.currency ?? item.currency, params: learnedParams(item.kind, r.horizon) })
            : null;
        next[item.id] = { longterm: r.longterm, horizon: r.horizon, interval: r.interval, result, candles: r.candles, fundamentals: r.fundamentals, news: r.news, candleSource: r.source, error: r.error ?? (r.candles.length < 30 && r.candles.length > 0 ? "Zu wenig Historie für eine Analyse" : undefined), loading: false };
        if (result) checkSignal(item, r.horizon, result);
        if (r.candles.length > 50) closeOnWave5End(item.symbol, r.horizon, r.candles);
        // Langfrist-Positionen auf denselben Kerzen begleiten (Meldung nur bei geänderter Zählung)
        for (const t of d.trades) {
          if (t.strategy !== "longterm" || t.status === "closed" || t.symbol !== item.symbol || t.interval !== r.interval) continue;
          const msg = checkLongTermWithCandles(t, r.candles);
          if (msg) notify(`Langfristig ${item.symbol}`, msg, { sound: d.settings.sound, notifications: d.settings.notifications, kind: "info" });
        }
      }
      if (Object.keys(next).length) setAnalyses((p) => ({ ...p, ...next }));
      trackTrades(d.trades, liveRef.current);
      checkWatchZones(d.watchlist, liveRef.current, instrumentKey);
    };
    run();
    const t = setInterval(run, 5000);
    return () => clearInterval(t);
  }, [dataVersion, settings.weights, settings.weightsMode]);

  const refresh = (id?: string) => {
    if (id) delete lastCalc.current[id];
    else lastCalc.current = {};
    setReloadTick((x) => x + 1);
  };

  return <MarketContext.Provider value={{ live, analyses, refresh }}>{children}</MarketContext.Provider>;
}

function checkSignal(item: WatchItem, horizon: Horizon, res: AnalysisResult) {
  const d = getData();
  const key = `${item.id}:${horizon}`;
  const prev = d.signals[key];
  const level = res.decision.level;
  if (prev?.level === level) return;
  actions.setSignal(key, level);
  if (!prev || level === "neutral") return; // erstes Signal bzw. Rückfall auf neutral: kein Alarm
  const buy = level.includes("buy");
  notify(
    `${SIGNAL_LABEL[level]}: ${item.symbol}`,
    `${res.commentary.summary}. ${res.commentary.reason}`,
    { sound: d.settings.sound, notifications: d.settings.notifications, kind: buy ? "buy" : "sell" },
  );
}

const lastTradeWrite: Record<string, number> = {};

/** Gelernter Ausstieg: nach Ziel 1 Gewinn sichern, wenn Welle 5 mit Divergenz endet (nur abgeschlossene Kerzen bis jetzt). */
function closeOnWave5End(symbol: string, horizon: Horizon, candles: Candle[]) {
  const d = getData();
  for (const t of d.trades) {
    if (t.symbol !== symbol || t.horizon !== horizon || t.status !== "open" || !t.trailing || !t.wave5Exit || t.strategy === "core" || t.strategy === "longterm") continue;
    const dir = t.direction === "long" ? 1 : -1;
    const r = rsi(candles.map((c) => c.close));
    if (!exhaustionAt(candles, r, candles.length - 1, dir)) continue;
    const exit = candles[candles.length - 1].close;
    const returnPct = tradeReturnEur(t, exit);
    actions.updateTrade(t.id, { status: "closed", exit, closedAt: Date.now(), closeReason: "welle5", returnPct, fxExit: eurPerUnit(tradeCurrency(t)) ?? undefined, lastPrice: exit });
    notify(`Gewinn gesichert: ${t.symbol}`, `Welle 5 läuft aus (RSI wird schwächer) – Trade bei ${money(exit, tradeCurrency(t))} geschlossen · ${returnPct >= 0 ? "+" : ""}${returnPct.toFixed(2).replace(".", ",")} %`, { sound: d.settings.sound, notifications: d.settings.notifications, kind: "info" });
  }
}

function trackTrades(trades: Trade[], live: Record<string, LiveState>) {
  const s = getData().settings;
  for (const t of trades) {
    if (t.status === "closed") continue;
    // Stop bei flatex (Euro) weicht ab – Wechselkurs oder nachgezogener Stop: einmal melden
    const hint = brokerStop(t);
    if (hint?.adjust && t.brokerStopNotified == null) {
      actions.updateTrade(t.id, { brokerStopNotified: hint.nowEur });
      notify(`Stop bei flatex anpassen: ${t.symbol}`, `Neuer Stop ${hint.nowEur.toFixed(2).replace(".", ",")} € statt ${hint.setEur.toFixed(2).replace(".", ",")} € (Wechselkurs bzw. nachgezogener Stop). Im Depot auf „Erledigt“ tippen, sobald geändert.`, { sound: s.sound, notifications: s.notifications, kind: "info" });
    }
    const lv = live[instrumentKey(t)];
    if (!lv?.price || lv.status === "offline") continue;
    const price = lv.price;
    if (t.strategy === "longterm") {
      // Langfristig: Teil-Orders ausführen, gesetzten Stop prüfen (Meldungen zur Zählung kommen aus der Kerzen-Prüfung)
      const msg = trackLongTerm(t, price);
      if (msg) notify(`Langfristig ${t.symbol}`, msg, { sound: s.sound, notifications: s.notifications, kind: "info" });
      else if (!lastTradeWrite[t.id] || Date.now() - lastTradeWrite[t.id] > 30e3) {
        lastTradeWrite[t.id] = Date.now();
        if (t.lastPrice !== price) actions.updateTrade(t.id, { lastPrice: price });
      }
      continue;
    }
    if (t.strategy === "core") {
      // Alte Kernposition (vor dem Update): nur den Kurs aktualisieren, schließen kann der Nutzer selbst
      if (!lastTradeWrite[t.id] || Date.now() - lastTradeWrite[t.id] > 30e3) {
        lastTradeWrite[t.id] = Date.now();
        if (t.lastPrice !== price) actions.updateTrade(t.id, { lastPrice: price });
      }
      continue;
    }
    const dir = t.direction === "long" ? 1 : -1;
    if (t.status === "pending") {
      // Wartende Limit-Order: Einstieg bei Erreichen der Zone, sonst verfallen lassen
      if ((price - t.entry) * dir <= 0) {
        actions.updateTrade(t.id, { status: "open", entry: dir === 1 ? Math.min(t.entry, price) : Math.max(t.entry, price), openedAt: Date.now(), lastPrice: price });
        notify(`Einstieg ausgeführt: ${t.symbol}`, `Der Kurs hat die ${dir === 1 ? "Kaufzone" : "Verkaufszone"} erreicht – Papier-Trade bei ${money(price, tradeCurrency(t))} eröffnet.`, {
          sound: s.sound,
          notifications: s.notifications,
          kind: dir === 1 ? "buy" : "sell",
        });
      } else if ((t.cancelAbove != null && (price - t.cancelAbove) * dir > 0) || (t.expiresAt && Date.now() > t.expiresAt)) {
        actions.updateTrade(t.id, { status: "closed", closedAt: Date.now(), closeReason: "cancelled", lastPrice: price });
      } else if (!lastTradeWrite[t.id] || Date.now() - lastTradeWrite[t.id] > 30e3) {
        lastTradeWrite[t.id] = Date.now();
        if (t.lastPrice !== price) actions.updateTrade(t.id, { lastPrice: price });
      }
      continue;
    }
    const sortedTargets = [...t.targets].sort((a, b) => (a - b) * dir);
    const target = s.closeAtTarget === "last" ? sortedTargets[sortedTargets.length - 1] : sortedTargets[0];
    let closeReason: Trade["closeReason"] | null = null;
    let exit = price;
    if (t.trailDistance) {
      // Gewinne laufen lassen: ab Ziel 1 Stop auf Einstieg, dann mit Abstand nachziehen
      let stop = t.stop;
      let trailing = !!t.trailing;
      if (!trailing && (price - sortedTargets[0]) * dir >= 0) {
        trailing = true;
        stop = dir === 1 ? Math.max(stop, t.entry) : Math.min(stop, t.entry);
        notify(`Ziel 1 erreicht: ${t.symbol}`, `Stop auf Einstieg ${money(t.entry, tradeCurrency(t))} gezogen – der Trade läuft jetzt ohne Verlustrisiko weiter.`, { sound: s.sound, notifications: s.notifications, kind: "info" });
      }
      if (trailing) {
        const trail = price - dir * t.trailDistance;
        if ((trail - stop) * dir > 0) stop = trail;
      }
      if (stop !== t.stop || trailing !== !!t.trailing) actions.updateTrade(t.id, { stop, trailing, initialStop: t.initialStop ?? t.stop });
      if ((price - stop) * dir <= 0) {
        closeReason = trailing ? "target" : "stop";
        exit = price;
      }
    } else if ((price - t.stop) * dir <= 0) {
      closeReason = "stop";
      exit = price;
    } else if (target != null && (price - target) * dir >= 0) {
      closeReason = "target";
      exit = price;
    }
    if (closeReason) {
      const returnPct = tradeReturnEur(t, exit);
      actions.updateTrade(t.id, { status: "closed", exit, closedAt: Date.now(), closeReason, returnPct, fxExit: eurPerUnit(tradeCurrency(t)) ?? undefined, lastPrice: price });
      notify(
        `Trade geschlossen: ${t.symbol}`,
        `${closeReason === "target" ? "Kursziel erreicht" : "Stop-Loss ausgelöst"} bei ${money(exit, tradeCurrency(t))} · ${returnPct >= 0 ? "+" : ""}${returnPct.toFixed(2).replace(".", ",")} %`,
        { sound: s.sound, notifications: s.notifications, kind: closeReason === "target" ? "buy" : "sell" },
      );
    } else if (!lastTradeWrite[t.id] || Date.now() - lastTradeWrite[t.id] > 30e3) {
      lastTradeWrite[t.id] = Date.now();
      if (t.lastPrice !== price) actions.updateTrade(t.id, { lastPrice: price });
    }
  }
}
