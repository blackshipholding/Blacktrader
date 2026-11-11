// Einmaliger Abschlusstest der aktuellen Version auf den gesperrten letzten 12 Monaten.
// Läuft über mehrere Aufrufe weiter (Zeitbudget); pro Version nur EIN Ergebnis.
import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/trainer/auth";
import { runCycle } from "@/lib/trainer/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ ok: false, note: "Zugangscode fehlt oder falsch" }, { status: 401 });
  try {
    return NextResponse.json(await runCycle({ budgetMs: 48_000, withSignals: false, final: true }));
  } catch (e) {
    return NextResponse.json({ ok: false, note: (e as Error).message }, { status: 500 });
  }
}
