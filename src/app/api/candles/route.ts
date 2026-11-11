import { binanceCandles } from "@/lib/data/binance";
import { UpstreamError } from "@/lib/data/http";
import { handle, param } from "@/lib/data/route-helpers";
import { yahooCandles, yahooCurrency } from "@/lib/data/yahoo";
import type { Interval } from "@/lib/types";

const INTERVALS: Interval[] = ["5m", "15m", "1h", "4h", "1d", "1w", "1M"];

export async function GET(req: Request) {
  const interval = param(req, "interval") as Interval;
  const binance = param(req, "binance");
  const yahoo = param(req, "yahoo");
  const ttl = interval === "5m" || interval === "15m" ? 15 : interval === "1h" || interval === "4h" ? 60 : 300;
  return handle(
    req,
    async () => {
      if (!INTERVALS.includes(interval)) throw new UpstreamError("Ungültiges Intervall", 400);
      const errors: string[] = [];
      if (binance) {
        try {
          return { candles: await binanceCandles(binance, interval), source: "Binance", delayed: false, currency: binance.endsWith("USDT") ? "USDT" : binance.endsWith("EUR") ? "EUR" : undefined };
        } catch (e) {
          errors.push((e as Error).message);
        }
      }
      if (yahoo) {
        try {
          const candles = await yahooCandles(yahoo, interval);
          return { candles, source: "Yahoo Finance", delayed: !binance, currency: yahooCurrency.get(yahoo) };
        } catch (e) {
          errors.push((e as Error).message);
        }
      }
      throw new UpstreamError(errors.join(" · ") || "Kein Symbol angegeben", errors.length ? 502 : 400);
    },
    ttl,
  );
}
