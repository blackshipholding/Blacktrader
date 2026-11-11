// Turnier-Auswertungen (Blacktrader gegen 9 Bots): die letzten 20 werden gespeichert und sind exportierbar.
import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/trainer/auth";
import { getJson, setJson } from "@/lib/trainer/storage";
import type { TournamentReport } from "@/lib/trainer/tournament";

export const dynamic = "force-dynamic";
const KEY = "trainer:tournament";

export async function GET() {
  return NextResponse.json({ reports: (await getJson<TournamentReport[]>(KEY)) ?? [] });
}

export async function POST(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ ok: false, note: "Zugangscode fehlt oder falsch" }, { status: 401 });
  const r = (await req.json().catch(() => null)) as TournamentReport | null;
  if (!r || typeof r.at !== "string" || !Array.isArray(r.ranking) || r.ranking.length > 20 || r.v !== 2 || !r.ranking.every((c) => typeof c.name === "string" && Number.isFinite(c.avgPerYear)))
    return NextResponse.json({ ok: false, note: "Ungültige Daten" }, { status: 400 });
  const list = (await getJson<TournamentReport[]>(KEY)) ?? [];
  await setJson(KEY, [r, ...list.filter((x) => x.at !== r.at)].slice(0, 20));
  return NextResponse.json({ ok: true });
}
