// Kraken-Kurse für den Kurs-Test (öffentliche Schnittstelle, ohne Schlüssel):
// Aktie → tokenisierte Aktie (AAPL → AAPLx/USD, läuft rund um die Uhr, kann vom echten Kurs abweichen);
// Krypto (?crypto=1) → Euro-Paar (ETH → ETH/EUR).
import { UpstreamError } from "@/lib/data/http";
import { handle, param } from "@/lib/data/route-helpers";

export async function GET(req: Request) {
  const sym = (param(req, "symbol") ?? "").toUpperCase();
  const crypto = param(req, "crypto") === "1";
  return handle(req, async () => {
    if (!/^[A-Z]{1,6}$/.test(sym)) throw new UpstreamError("Kein gültiges Kürzel", 400);
    const pair = crypto ? `${sym === "BTC" ? "XBT" : sym}EUR` : `${sym}xUSD`;
    const res = await fetch(`https://api.kraken.com/0/public/Ticker?pair=${pair}`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new UpstreamError(`Kraken ${res.status}`, 502);
    const j = (await res.json()) as { error?: string[]; result?: Record<string, { c?: [string, string] }> };
    const first = j.result ? Object.values(j.result)[0] : undefined;
    const price = Number(first?.c?.[0]);
    if (!(price > 0)) throw new UpstreamError(j.error?.[0] ?? "Keine Notierung bei Kraken", 404);
    return { symbol: crypto ? pair : `${sym}x`, price, currency: crypto ? "EUR" : "USD", time: Math.floor(Date.now() / 1000), source: crypto ? "Kraken EUR" : "Kraken xStocks" };
  }, 5);
}
