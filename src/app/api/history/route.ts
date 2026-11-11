// Lange Kurshistorien für das EchoChart.
// Binance: seitenweise (?binance=…&start=<ms>, je bis 1000 Kerzen) – der Browser lädt Seite für Seite.
// Yahoo: ein Abruf (?yahoo=…&days=N), begrenzt auf das, was Yahoo je Kerzengröße liefert.
import { binanceCandlesFrom } from "@/lib/data/binance";
import { UpstreamError } from "@/lib/data/http";
import { handle, param } from "@/lib/data/route-helpers";
import { yahooHistory } from "@/lib/data/yahoo";
import type { Interval } from "@/lib/types";

const INTERVALS: Interval[] = ["5m", "15m", "1h", "4h", "1d", "1w", "1M"];

export async function GET(req: Request) {
  const interval = param(req, "interval") as Interval;
  const binance = param(req, "binance");
  const yahoo = param(req, "yahoo");
  const start = Number(param(req, "start"));
  const days = Number(param(req, "days"));
  return handle(req, async () => {
    if (!INTERVALS.includes(interval)) throw new UpstreamError("Ungültiges Intervall", 400);
    if (binance) {
      if (!Number.isFinite(start) || start <= 0) throw new UpstreamError("Startzeit fehlt", 400);
      return { candles: await binanceCandlesFrom(binance, interval, start), source: "Binance" };
    }
    if (yahoo) {
      if (!(days > 0)) throw new UpstreamError("Zeitraum fehlt", 400);
      const r = await yahooHistory(yahoo, interval, days);
      return { candles: r.candles, days: r.days, dividends: r.dividends, source: "Yahoo Finance" };
    }
    throw new UpstreamError("Kein Symbol angegeben", 400);
  });
}
