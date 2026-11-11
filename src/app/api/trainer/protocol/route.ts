// Messprotokoll je Klasse × Horizont: jede bewertete Zone (Wert, Zeiteinheit, Zeitpunkt, Richtung, Kanten, Ergebnis).
import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/trainer/auth";
import { loadProtocol, saveProtocol } from "@/lib/trainer/cellStore";
import { CELL_KEYS, type CellKey } from "@/lib/trainer/universe";
import type { ProtocolEntry } from "@/lib/trainer/walkforward";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const cell = new URL(req.url).searchParams.get("cell") as CellKey | null;
  if (!cell || !CELL_KEYS.includes(cell)) return NextResponse.json({ ok: false, note: "Bereich fehlt" }, { status: 400 });
  return NextResponse.json(await loadProtocol(cell));
}

const valid = (e: unknown): e is ProtocolEntry => {
  const x = e as ProtocolEntry;
  return !!x && typeof x.symbol === "string" && typeof x.tf === "string" && typeof x.t === "number" && (x.dir === 1 || x.dir === -1) && typeof x.top === "number" && typeof x.bottom === "number" && (x.ok === 0 || x.ok === 1);
};

export async function POST(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ ok: false, note: "Zugangscode fehlt oder falsch" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { cell?: string; entries?: unknown[] };
  if (!CELL_KEYS.includes(b.cell as CellKey) || !Array.isArray(b.entries)) return NextResponse.json({ ok: false, note: "Ungültige Daten" }, { status: 400 });
  const entries = b.entries.filter(valid).slice(-3000);
  await saveProtocol(b.cell as CellKey, entries, "Browser-Training");
  return NextResponse.json({ ok: true, saved: entries.length });
}
