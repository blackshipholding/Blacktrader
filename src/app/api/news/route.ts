import { getNews } from "@/lib/data/news";
import { handle, param } from "@/lib/data/route-helpers";

export async function GET(req: Request) {
  const q = param(req, "q") ?? "";
  const yahoo = param(req, "yahoo");
  const finnhubKey = req.headers.get("x-finnhub-key") || undefined;
  const finnhubSymbol = yahoo && !yahoo.includes(".") && !yahoo.includes("-") ? yahoo : undefined;
  return handle(req, async () => ({ news: q ? await getNews({ query: q, yahooSymbol: yahoo, finnhubKey, finnhubSymbol }) : [] }), finnhubKey ? 0 : 600);
}
