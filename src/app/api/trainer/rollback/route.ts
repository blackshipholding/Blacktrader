// Eine Zelle (Klasse × Horizont) auf ihre vorige oder eine bestimmte Version zurücksetzen. Andere Zellen bleiben unberührt.
import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/trainer/auth";
import { rollbackCell } from "@/lib/trainer/server";
import { CELL_KEYS, type CellKey } from "@/lib/trainer/universe";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ ok: false, note: "Zugangscode fehlt oder falsch" }, { status: 401 });
  try {
    const body = (await req.json().catch(() => ({}))) as { cell?: string; to?: number };
    if (!CELL_KEYS.includes(body.cell as CellKey)) return NextResponse.json({ ok: false, note: "Bereich fehlt" }, { status: 400 });
    const r = await rollbackCell(body.cell as CellKey, typeof body.to === "number" ? body.to : undefined);
    if (!r) return NextResponse.json({ ok: false, note: "Keine ältere Version vorhanden." }, { status: 400 });
    return NextResponse.json({ ok: true, note: `Zurückgesetzt auf Version ${r.version}`, version: r.version });
  } catch (e) {
    return NextResponse.json({ ok: false, note: (e as Error).message }, { status: 500 });
  }
}
