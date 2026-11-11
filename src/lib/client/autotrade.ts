"use client";
// Papier-Trades aus einem Analyse-Ergebnis anlegen (manuell oder automatisch).
import { makeOrderSlip } from "./orderSlip";
import type { AnalysisResult } from "../analysis/analyze";
import { plainSetup } from "../analysis/persona";
import { tradeReturnPct } from "../analysis/stats";
import { actions, getData } from "../store/store";
import { canAfford, freeCash, noMoney, noTwice } from "./account";
import { openPositions } from "./nachkauf";
import type { ResolvedAsset } from "../types";

const INTERVAL_MS = { "5m": 300e3, "15m": 900e3, "1h": 3600e3, "4h": 14400e3, "1d": 86400e3, "1w": 604800e3, "1M": 2592000e3 } as const;

type Asset = Pick<ResolvedAsset, "kind" | "symbol" | "name" | "binanceSymbol" | "yahooSymbol" | "currency">;

export function hasOpenTrade(symbol: string, horizon: AnalysisResult["horizon"]): boolean {
  return getData().trades.some((t) => t.status !== "closed" && t.symbol === symbol && t.horizon === horizon && t.strategy !== "core");
}

/** Legt einen Papier-Trade an, sofern ein Signal mit Plan vorliegt und noch keiner offen ist. */
export function openPaperTrade(asset: Asset, res: AnalysisResult): boolean {
  const plan = res.plan;
  if (!plan || res.decision.level === "neutral" || hasOpenTrade(asset.symbol, res.horizon)) return false;
  // Eine Position je Wert (wie im Test); nachkaufen geht nur bei blauen Einstiegen
  if (openPositions(asset.symbol).length > 0) {
    noTwice();
    return false;
  }
  const slip = makeOrderSlip({ kind: asset.kind, symbol: asset.symbol, name: asset.name, currency: asset.currency, direction: plan.direction, entry: plan.entry, stop: plan.stop });
  const amount = slip.totalEur > 0 ? slip.totalEur : undefined;
  if (!canAfford(getData().trades, getData().accountResets, amount)) {
    noMoney(freeCash(getData().trades, getData().accountResets));
    return false;
  }
  const c = res.commentary;
  const limit = plan.orderType === "limit";
  actions.addTrade({
    status: limit ? "pending" : "open",
    orderType: plan.orderType,
    cancelAbove: plan.cancelAbove,
    trailDistance: plan.trailDistance,
    wave5Exit: plan.wave5Exit || undefined,
    initialStop: plan.stop,
    // Wartende Order verfällt nach 60 Kerzen (wie im EchoChart gemessen)
    expiresAt: limit ? Date.now() + 60 * INTERVAL_MS[res.interval] : undefined,
    symbol: asset.symbol,
    name: asset.name,
    kind: asset.kind,
    binanceSymbol: asset.binanceSymbol,
    yahooSymbol: asset.yahooSymbol,
    currency: asset.currency,
    direction: plan.direction,
    horizon: res.horizon,
    interval: res.interval,
    entry: plan.entry,
    stop: plan.stop,
    targets: plan.targets,
    openedAt: Date.now(),
    reason: [c.summary, c.reason, c.risk].filter(Boolean).join("\n"),
    score: res.total,
    signal: res.decision.level,
    pattern: plainSetup(res.elliott.best),
    lastPrice: res.price,
    // Order-Zettel: Stückzahl und Stop in Euro, wie bei flatex eingegeben
    shares: slip.orders[0].qty,
    stakeEur: amount,
    brokerStopEur: slip.stopEur,
  });
  return true;
}
