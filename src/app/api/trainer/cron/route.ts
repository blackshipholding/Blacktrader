// Nächtlicher Lauf (Vercel Cron, siehe vercel.json): Signal-Protokoll auswerten, kleine Lernschritte.
import { NextResponse } from "next/server";
import { isCron } from "@/lib/trainer/auth";
import { runCycle } from "@/lib/trainer/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!isCron(req)) return NextResponse.json({ error: "Nicht erlaubt" }, { status: 401 });
  try {
    return NextResponse.json(await runCycle({ budgetMs: 48_000, withSignals: true }));
  } catch (e) {
    return NextResponse.json({ ok: false, note: (e as Error).message }, { status: 500 });
  }
}
