// Welche Kursreihen der Trainer zum Lernen nutzt (je Anlageklasse und Horizont).
// Mehr Werte als im Chancen-Scanner, damit genug Signale (≥ 200) zusammenkommen.
import type { AssetKind, Horizon, Interval } from "../types";

export interface SeriesSpec {
  symbol: string;
  kind: AssetKind;
  horizon: Horizon;
  interval: Interval;
  /** Wie weit zurück (Tage) */
  days: number;
  /** Jede n-te Kerze bewerten (Rechenzeit) */
  step: number;
}

export const CELL_KEYS = (["stock", "crypto", "commodity"] as AssetKind[]).flatMap((k) => (["short", "medium", "long"] as Horizon[]).map((h) => `${k}:${h}` as const));
export type CellKey = (typeof CELL_KEYS)[number];
/** Blacktrader: Aktien und Krypto ohne kurzfristige Signale – diese Bereiche werden nicht mehr trainiert (alte Stände bleiben gespeichert). */
export const ACTIVE_CELL_KEYS: CellKey[] = CELL_KEYS.filter((c) => c !== "stock:short" && c !== "crypto:short");

const STOCKS = [
  "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "JPM", "V", "MA", "UNH", "HD", "PG", "KO", "PEP", "XOM", "CVX", "JNJ", "MRK", "ABBV",
  "WMT", "COST", "DIS", "NFLX", "ADBE", "CRM", "ORCL", "INTC", "AMD", "CSCO",
  "SAP.DE", "SIE.DE", "ALV.DE", "DTE.DE", "RHM.DE", "MBG.DE", "BAS.DE", "BAYN.DE", "BMW.DE", "VOW3.DE",
];
const CRYPTO = ["BTC", "ETH", "SOL", "XRP", "BNB", "DOGE", "ADA", "TRX", "LTC", "LINK", "AVAX", "DOT", "BCH", "XLM", "ATOM"].map((s) => `${s}-USD`);
const COMMODITIES = ["GC=F", "SI=F", "CL=F", "BZ=F", "NG=F", "HG=F", "PL=F", "PA=F", "ZC=F", "ZW=F"];

/** Kerzengröße und Zeitraum je Horizont (Yahoo liefert Stundenkerzen nur für ca. 2 Jahre). */
export const HORIZON_SETUP: Record<Horizon, { interval: Interval; days: number; step: number }> = {
  short: { interval: "1h", days: 729, step: 2 },
  medium: { interval: "1d", days: 5 * 365, step: 1 },
  long: { interval: "1w", days: 15 * 365, step: 1 },
};

export function universe(cell: CellKey): SeriesSpec[] {
  const [kind, horizon] = cell.split(":") as [AssetKind, Horizon];
  const list = kind === "stock" ? STOCKS : kind === "crypto" ? CRYPTO : COMMODITIES;
  // Stundenkerzen: bei Aktien weniger Werte (Rechenzeit), Krypto handelt rund um die Uhr
  const symbols = horizon === "short" && kind === "stock" ? list.slice(0, 25) : list;
  const s = HORIZON_SETUP[horizon];
  return symbols.map((symbol) => ({ symbol, kind, horizon, interval: s.interval, days: s.days, step: s.step }));
}

/** Große Indizes (als Aktien-Klasse gelernt) */
export const INDICES = ["^GSPC", "^NDX", "^DJI", "^RUT", "^GDAXI", "^STOXX50E", "^FTSE", "^FCHI", "^N225", "^HSI"];

/**
 * Lernwerte für das Browser-Training: alles aus `universe` + Indizes + zusätzliche Werte
 * (Chancen und Watchlist). Krypto über Yahoo (XXX-USD), damit eine Abfrage mehrere Jahre liefert.
 */
export function sessionUniverse(cell: CellKey, extra: { symbol: string; kind: AssetKind; yahooSymbol?: string }[] = []): SeriesSpec[] {
  const [kind, horizon] = cell.split(":") as [AssetKind, Horizon];
  const base = universe(cell);
  const s = HORIZON_SETUP[horizon];
  const syms = new Set(base.map((b) => b.symbol));
  const add: string[] = [];
  if (kind === "stock") add.push(...INDICES);
  if (kind === "stock" && horizon === "short") add.push(...STOCKS.slice(25));
  for (const e of extra) if (e.kind === kind) add.push(e.yahooSymbol ?? (kind === "crypto" ? `${e.symbol}-USD` : e.symbol));
  const out = [...base];
  for (const symbol of add) if (!syms.has(symbol)) (syms.add(symbol), out.push({ symbol, kind, horizon, interval: s.interval, days: s.days, step: s.step }));
  return out;
}
