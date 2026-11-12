// Kurs einer tokenisierten Aktie (Kraken xStocks, z. B. AAPL → AAPLx/USD) – nur für den Kurs-Test: läuft rund um die Uhr,
// kann aber vom echten Kurs abweichen. Öffentliche Kraken-Schnittstelle, ohne Schlüssel.
import { UpstreamError } from "@/lib/data/http";
import { handle, param } from "@/lib/data/route-helpers";

export async function GET(req: Request) {
  const sym = (param(req, "symbol") ?? "").toUpperCase();
  return handle(req, async () => {
    if (!/^[A-Z]{1,6}$/.test(sym)) throw new UpstreamError("Kein gültiges Kürzel", 400);
    const res = await fetch(`https://api.kraken.com/0/public/Ticker?pair=${sym}xUSD`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new UpstreamError(`Kraken ${res.status}`, 502);
    const j = (await res.json()) as { error?: string[]; result?: Record<string, { c?: [string, string] }> };
    const first = j.result ? Object.values(j.result)[0] : undefined;
    const price = Number(first?.c?.[0]);
    if (!(price > 0)) throw new UpstreamError(j.error?.[0] ?? "Keine Notierung bei Kraken", 404);
    return { symbol: `${sym}x`, price, currency: "USD", time: Math.floor(Date.now() / 1000), source: "Kraken xStocks" };
  }, 5);
}
