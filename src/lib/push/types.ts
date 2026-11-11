// Gemeinsame Typen für Push-Nachrichten (App ↔ Server).
import type { Trade } from "../store/store";
import type { AssetKind, Interval } from "../types";

/** Was der Server für die Überwachung braucht (bleibt in deinem eigenen Speicher). */
export type PushTrade = Pick<
  Trade,
  "id" | "symbol" | "name" | "kind" | "yahooSymbol" | "binanceSymbol" | "interval" | "strategy" | "direction" | "status" | "entry" | "stop" | "targets" | "tranches" | "lt" | "lastActionKey" | "remaining"
>;
export interface PushWatch {
  symbol: string;
  name: string;
  kind: AssetKind;
  yahooSymbol?: string;
  binanceSymbol?: string;
}
export interface PushSubscriptionJSON {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}
export interface PushRecord {
  sub: PushSubscriptionJSON;
  trades: PushTrade[];
  watch: PushWatch[];
  /** Kerzengröße für die Langfrist-Bereiche der Watchlist */
  ltInterval: Interval;
  /** Bereits gesendete Meldungen (Kennungen) */
  sent: string[];
  updatedAt: string;
}

export function pushTradeFrom(t: Trade): PushTrade {
  const { id, symbol, name, kind, yahooSymbol, binanceSymbol, interval, strategy, direction, status, entry, stop, targets, tranches, lt, lastActionKey, remaining } = t;
  return { id, symbol, name, kind, yahooSymbol, binanceSymbol, interval, strategy, direction, status, entry, stop, targets, tranches, lt, lastActionKey, remaining };
}
