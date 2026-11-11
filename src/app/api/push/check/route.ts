// Regelmäßige Prüfung für Push-Nachrichten (Vercel Cron bzw. externer Zeitplan mit CRON_SECRET).
import { NextResponse } from "next/server";
import { isCron } from "@/lib/trainer/auth";
import { runPushCheck } from "@/lib/push/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!isCron(req)) return NextResponse.json({ error: "Nicht erlaubt" }, { status: 401 });
  try {
    return NextResponse.json(await runPushCheck(48_000));
  } catch (e) {
    return NextResponse.json({ ok: false, note: (e as Error).message }, { status: 500 });
  }
}
