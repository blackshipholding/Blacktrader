// EchoChart-Messungen für den Trainer aufbewahren (die letzten 30), damit sie ausgewertet werden können.
import { NextResponse } from "next/server";
import { getJson, setJson } from "@/lib/trainer/storage";

export const dynamic = "force-dynamic";
const KEY = "trainer:echochart";

export async function GET() {
  return NextResponse.json((await getJson<unknown[]>(KEY)) ?? []);
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b.label !== "string" || !Array.isArray(b.zones)) return NextResponse.json({ ok: false }, { status: 400 });
  const entry = { at: new Date().toISOString(), label: b.label.slice(0, 80), horizon: b.horizon, interval: b.interval, days: b.days, summary: b.summary, zones: b.zones.slice(-300) };
  const list = ((await getJson<unknown[]>(KEY)) ?? []).slice(-29);
  await setJson(KEY, [...list, entry]);
  return NextResponse.json({ ok: true });
}
