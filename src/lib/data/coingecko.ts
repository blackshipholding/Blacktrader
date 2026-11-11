// CoinGecko (Demo-/Public-API ohne Key, ca. 5–30 Anfragen/Minute).
import "server-only";
import type { CryptoFundamentals } from "../types";
import { cached, fetchJson } from "./http";

const BASE = "https://api.coingecko.com/api/v3";

export interface CoinHit {
  id: string;
  symbol: string;
  name: string;
  market_cap_rank: number | null;
}

export async function coingeckoSearch(q: string): Promise<CoinHit[]> {
  return cached(`cgs:${q.toLowerCase()}`, 24 * 3600e3, async () => {
    const r = await fetchJson<{ coins?: CoinHit[] }>(`${BASE}/search?query=${encodeURIComponent(q)}`);
    return r.coins ?? [];
  });
}

export async function coingeckoFundamentals(id: string): Promise<CryptoFundamentals> {
  return cached(`cgf:${id}`, 30 * 60e3, async () => {
    const r = await fetchJson<{
      market_cap_rank?: number;
      market_data?: {
        market_cap?: { usd?: number };
        total_volume?: { usd?: number };
        circulating_supply?: number;
        total_supply?: number | null;
        max_supply?: number | null;
        price_change_percentage_7d?: number;
        price_change_percentage_30d?: number;
        ath_change_percentage?: { usd?: number };
      };
      developer_data?: { commit_count_4_weeks?: number; stars?: number; pull_request_contributors?: number };
    }>(`${BASE}/coins/${encodeURIComponent(id)}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=true&sparkline=false`);
    const md = r.market_data ?? {};
    return {
      kind: "crypto",
      marketCap: md.market_cap?.usd,
      marketCapRank: r.market_cap_rank,
      volume24h: md.total_volume?.usd,
      circulatingSupply: md.circulating_supply,
      totalSupply: md.total_supply ?? undefined,
      maxSupply: md.max_supply ?? undefined,
      change7d: md.price_change_percentage_7d,
      change30d: md.price_change_percentage_30d,
      athChangePct: md.ath_change_percentage?.usd,
      devCommits4w: r.developer_data?.commit_count_4_weeks,
      devStars: r.developer_data?.stars,
      devContributors: r.developer_data?.pull_request_contributors,
      source: "CoinGecko",
    };
  });
}
