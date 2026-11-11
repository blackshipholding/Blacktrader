// Push-Abo speichern bzw. aktualisieren (mit den offenen Trades und der Watchlist, die überwacht werden sollen).
import { NextResponse } from "next/server";
import { saveSubscription } from "@/lib/push/server";
import type { PushTrade, PushWatch } from "@/lib/push/types";
import type { Interval } from "@/lib/types";

export const dynamic = "force-dynamic";
const IV: Interval[] = ["5m", "15m", "1h", "4h", "1d", "1w", "1M"];

export async function POST(req: Request) {
  try {
    const b = (await req.json()) as { sub?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } }; trades?: PushTrade[]; watch?: PushWatch[]; ltInterval?: Interval };
    const s = b.sub;
    if (!s?.endpoint || !/^https:\/\//.test(s.endpoint) || !s.keys?.p256dh || !s.keys?.auth) return NextResponse.json({ ok: false, note: "Ungültiges Abo" }, { status: 400 });
    const trades = (Array.isArray(b.trades) ? b.trades : []).filter((t) => t && typeof t.symbol === "string" && IV.includes(t.interval)).slice(0, 60);
    const watch = (Array.isArray(b.watch) ? b.watch : []).filter((w) => w && typeof w.symbol === "string").slice(0, 60);
    await saveSubscription({ sub: { endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } }, trades, watch, ltInterval: IV.includes(b.ltInterval!) ? b.ltInterval! : "1w" });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, note: (e as Error).message }, { status: 500 });
  }
}
