import "server-only";
import { NextResponse } from "next/server";
import { UpstreamError } from "./http";
import { checkRateLimit } from "./ratelimit";

/** Einheitliche Behandlung: Rate-Limit, Fehler → JSON, CDN-Cache-Header. */
export async function handle(req: Request, fn: () => Promise<unknown>, sMaxAge = 0): Promise<NextResponse> {
  if (!checkRateLimit(req)) return NextResponse.json({ error: "Zu viele Anfragen – bitte kurz warten." }, { status: 429 });
  try {
    const data = await fn();
    return NextResponse.json(data, {
      headers: sMaxAge > 0 ? { "Cache-Control": `public, s-maxage=${sMaxAge}, stale-while-revalidate=${sMaxAge * 4}` } : { "Cache-Control": "no-store" },
    });
  } catch (e) {
    const status = e instanceof UpstreamError ? e.status : 500;
    return NextResponse.json({ error: (e as Error).message || "Unbekannter Fehler" }, { status });
  }
}

export const param = (req: Request, name: string) => new URL(req.url).searchParams.get(name) ?? undefined;
