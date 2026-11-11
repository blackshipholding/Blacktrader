// Hoch-/Herabstufungen von Bank-Analysten (für die Analysten-Gegner im Turnier).
import { UpstreamError } from "@/lib/data/http";
import { handle, param } from "@/lib/data/route-helpers";
import { yahooAnalysts } from "@/lib/data/yahoo";

export async function GET(req: Request) {
  const symbol = param(req, "symbol");
  return handle(
    req,
    async () => {
      if (!symbol || !/^[A-Za-z0-9.\-^=]{1,20}$/.test(symbol)) throw new UpstreamError("Symbol fehlt", 400);
      return { actions: await yahooAnalysts(symbol) };
    },
    12 * 3600,
  );
}
