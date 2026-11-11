// Gemeinsame Typen für Daten, Analyse und Speicher.

export type AssetKind = "stock" | "crypto" | "commodity";

export const KIND_LABEL: Record<AssetKind, string> = { stock: "Aktien", crypto: "Krypto", commodity: "Rohstoffe" };
export type Horizon = "short" | "medium" | "long";
export type Interval = "5m" | "15m" | "1h" | "4h" | "1d" | "1w" | "1M";

export const HORIZON_INTERVALS: Record<Horizon, Interval[]> = {
  short: ["5m", "15m", "1h"],
  medium: ["4h", "1d"],
  long: ["1w", "1M"],
};

export const HORIZON_DEFAULT_INTERVAL: Record<Horizon, Interval> = {
  short: "1h",
  medium: "1d",
  long: "1w",
};

export const HORIZON_LABEL: Record<Horizon, string> = {
  short: "Kurzfristig",
  medium: "Mittelfristig",
  long: "Langfristig",
};

export interface Candle {
  /** Unix-Zeit in Sekunden (Kerzenbeginn) */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ResolvedAsset {
  kind: AssetKind;
  /** Anzeige-Symbol (z. B. AAPL, SAP.DE, BTC) */
  symbol: string;
  name: string;
  isin?: string;
  exchange?: string;
  currency?: string;
  /** Symbol für Yahoo Finance (Aktien, Fallback für Krypto: BTC-USD) */
  yahooSymbol?: string;
  /** Binance-Paar, z. B. BTCUSDT */
  binanceSymbol?: string;
  coingeckoId?: string;
}

export interface Quote {
  symbol: string;
  price: number;
  changePct: number;
  currency?: string;
  /** Unix-Sekunden des letzten Kurses */
  time: number;
  delayed: boolean;
  source: string;
}

export type Sentiment = "positive" | "neutral" | "negative";

export interface NewsItem {
  title: string;
  link: string;
  source: string;
  /** ISO-Datum */
  published: string;
  sentiment: Sentiment;
  /** -1 … +1 */
  sentimentScore: number;
  /** Originaltitel, falls übersetzt */
  originalTitle?: string;
  /** Sprache des angezeigten Titels */
  lang?: "de" | "en";
  /** true = automatisch ins Deutsche übersetzt */
  translated?: boolean;
}

export interface StockFundamentals {
  kind: "stock";
  pe?: number; // KGV
  ps?: number; // KUV
  pb?: number; // KBV
  epsGrowth?: number; // als Anteil, 0.12 = 12 %
  revenueGrowth?: number;
  profitMargin?: number;
  debtToEquity?: number; // in %, wie Yahoo (z. B. 150 = 1,5x)
  freeCashflow?: number;
  marketCap?: number;
  dividendYield?: number; // Anteil
  nextEarnings?: string; // ISO-Datum
  currency?: string;
  source: string;
}

export interface CryptoFundamentals {
  kind: "crypto";
  marketCap?: number;
  marketCapRank?: number;
  volume24h?: number;
  circulatingSupply?: number;
  totalSupply?: number;
  maxSupply?: number;
  /** Prozentuale Veränderung 24h / 7d / 30d */
  change7d?: number;
  change30d?: number;
  athChangePct?: number;
  devCommits4w?: number;
  devStars?: number;
  devContributors?: number;
  source: string;
}

export type Fundamentals = StockFundamentals | CryptoFundamentals;
