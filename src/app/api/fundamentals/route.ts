import { coingeckoFundamentals } from "@/lib/data/coingecko";
import { UpstreamError } from "@/lib/data/http";
import { alphaVantageFundamentals, finnhubFundamentals, mergeFundamentals } from "@/lib/data/optional";
import { handle, param } from "@/lib/data/route-helpers";
import { nasdaqFundamentals } from "@/lib/data/nasdaq";
import { yahooFundamentals } from "@/lib/data/yahoo";
import type { StockFundamentals } from "@/lib/types";

export async function GET(req: Request) {
  const kind = param(req, "kind");
  const symbol = param(req, "symbol");
  const id = param(req, "id");
  const finnhubKey = req.headers.get("x-finnhub-key") || undefined;
  const avKey = req.headers.get("x-alphavantage-key") || undefined;
  return handle(req, async () => {
    if (kind === "commodity") return { fundamentals: null, note: "Rohstoffe haben keine Firmenzahlen." };
    if (kind === "crypto") {
      if (!id) return { fundamentals: null, note: "Keine CoinGecko-ID – Fundamentaldaten nicht verfügbar." };
      try {
        return { fundamentals: await coingeckoFundamentals(id) };
      } catch (e) {
        return { fundamentals: null, note: `CoinGecko: ${(e as Error).message}` };
      }
    }
    if (!symbol) throw new UpstreamError("Symbol fehlt", 400);
    const errors: string[] = [];
    let f: StockFundamentals | null = null;
    try {
      f = await yahooFundamentals(symbol);
    } catch (e) {
      errors.push((e as Error).message);
    }
    // US-Kürzel ohne Börsensuffix für Finnhub/Alpha Vantage
    const plain = symbol.includes(".") ? undefined : symbol;
    if (finnhubKey && plain) {
      try {
        f = mergeFundamentals(f, await finnhubFundamentals(plain, finnhubKey));
      } catch (e) {
        errors.push((e as Error).message);
      }
    }
    // Zweite kostenlose Quelle für US-Aktien, wenn Yahoo nichts oder zu wenig liefert
    if (plain && (!f || f.pe == null)) {
      try {
        f = mergeFundamentals(f, await nasdaqFundamentals(plain));
      } catch (e) {
        errors.push((e as Error).message);
      }
    }
    if (avKey && plain && (!f || f.pe == null)) {
      try {
        f = mergeFundamentals(f, await alphaVantageFundamentals(plain, avKey));
      } catch (e) {
        errors.push((e as Error).message);
      }
    }
    if (!f && !plain) errors.push("Für Nicht-US-Aktien gibt es außer Yahoo keine kostenlose Quelle ohne Schlüssel");
    return { fundamentals: f, note: f ? undefined : errors.join(" · ") || "Keine Quelle hat Daten geliefert" };
  }, finnhubKey || avKey ? 0 : 3600);
}
