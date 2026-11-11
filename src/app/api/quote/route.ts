import { binanceQuote } from "@/lib/data/binance";
import { UpstreamError } from "@/lib/data/http";
import { handle, param } from "@/lib/data/route-helpers";
import { yahooQuote } from "@/lib/data/yahoo";

export async function GET(req: Request) {
  const binance = param(req, "binance");
  const yahoo = param(req, "yahoo");
  return handle(req, async () => {
    const errors: string[] = [];
    if (binance) {
      try {
        return await binanceQuote(binance);
      } catch (e) {
        errors.push((e as Error).message);
      }
    }
    if (yahoo) {
      try {
        const { meta: _meta, ...q } = await yahooQuote(yahoo);
        return q;
      } catch (e) {
        errors.push((e as Error).message);
      }
    }
    throw new UpstreamError(errors.join(" · ") || "Kein Symbol angegeben", errors.length ? 502 : 400);
  }, 5);
}
