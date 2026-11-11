// OpenFIGI: ISIN → Ticker/Börse (kostenlos, ohne Key ca. 25 Anfragen/Minute).
import "server-only";
import { cached, fetchJson } from "./http";

export interface FigiHit {
  ticker: string;
  name: string;
  exchCode: string;
  securityType?: string;
  marketSector?: string;
}

/** Bloomberg-Börsencode → Yahoo-Suffix */
export const EXCH_TO_YAHOO: Record<string, string> = {
  US: "", UN: "", UW: "", UQ: "", UA: "", UR: "", UP: "",
  GY: ".DE", GR: ".DE", GF: ".F", GS: ".SG", GM: ".MU", GD: ".DU", GB: ".BE", GH: ".HM", GI: ".HA",
  LN: ".L", FP: ".PA", NA: ".AS", BB: ".BR", SM: ".MC", IM: ".MI", SW: ".SW", SE: ".SW", AV: ".VI",
  DC: ".CO", SS: ".ST", NO: ".OL", FH: ".HE", PL: ".LS", ID: ".IR", JT: ".T", HK: ".HK", CT: ".TO", AU: ".AX",
};

/** Bevorzugte Börsen je ISIN-Land (Heimatbörse zuerst, dann Xetra/US). */
const PREFERRED: Record<string, string[]> = {
  US: ["US", "UN", "UW", "UQ"],
  DE: ["GY", "GR", "GF"],
  GB: ["LN"],
  FR: ["FP"],
  NL: ["NA"],
  CH: ["SW", "SE"],
  IE: ["GY", "LN", "NA"],
  LU: ["GY", "LN", "FP"],
};

export async function openFigiByIsin(isin: string, apiKey?: string): Promise<FigiHit[]> {
  return cached(`figi:${isin}`, 7 * 24 * 3600e3, async () => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) headers["X-OPENFIGI-APIKEY"] = apiKey;
    const r = await fetchJson<{ data?: FigiHit[]; warning?: string }[]>("https://api.openfigi.com/v3/mapping", {
      method: "POST",
      headers,
      body: JSON.stringify([{ idType: "ID_ISIN", idValue: isin }]),
    });
    return r[0]?.data ?? [];
  });
}

/** Wählt aus den FIGI-Treffern die sinnvollste Yahoo-Notierung. */
export function pickYahooSymbol(isin: string, hits: FigiHit[]): { symbol: string; hit: FigiHit } | null {
  const country = isin.slice(0, 2);
  const order = [...(PREFERRED[country] ?? []), "GY", "US", "LN", ...Object.keys(EXCH_TO_YAHOO)];
  for (const ex of order) {
    const hit = hits.find((h) => h.exchCode === ex && h.ticker);
    if (hit) return { symbol: `${hit.ticker.replace(/\//g, "-").replace(/ /g, "-")}${EXCH_TO_YAHOO[ex]}`, hit };
  }
  return null;
}
