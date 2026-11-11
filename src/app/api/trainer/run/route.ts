// Manueller Lernschritt aus der App (gleiche Regeln wie nachts, höchstens alle 3 Minuten).
import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/trainer/auth";
import { loadState, runCycle } from "@/lib/trainer/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ ok: false, note: "Zugangscode fehlt oder falsch" }, { status: 401 });
  try {
    const s = await loadState();
    if (s.lastRun && Date.now() - Date.parse(s.lastRun) < 3 * 60e3) return NextResponse.json({ ok: false, note: "Bitte 3 Minuten warten – der letzte Lauf ist gerade erst fertig." }, { status: 429 });
    return NextResponse.json(await runCycle({ budgetMs: 48_000, withSignals: false }));
  } catch (e) {
    return NextResponse.json({ ok: false, note: (e as Error).message }, { status: 500 });
  }
}
