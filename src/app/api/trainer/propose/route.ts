// Ergebnis aus dem Browser-Training für EINE Zelle (Klasse × Horizont). Wird sofort und atomar gespeichert –
// aber nur, wenn es auf unbekannten Daten besser ist und alle Strenge-Regeln erfüllt (Prüfung hier auf dem Server).
import { NextResponse } from "next/server";
import { DEFAULT_PARAMS, type LearnableParams } from "@/lib/analysis/params";
import { isAdmin } from "@/lib/trainer/auth";
import type { Metrics } from "@/lib/trainer/engine";
import { serverCells } from "@/lib/trainer/server";
import { CELL_KEYS, type CellKey } from "@/lib/trainer/universe";

export const dynamic = "force-dynamic";

const isMetrics = (m: unknown): m is Metrics =>
  !!m && typeof m === "object" && ["trades", "hitRate", "avgWin", "avgLoss", "profitFactor", "maxDrawdown", "perMonth"].every((k) => typeof (m as Record<string, unknown>)[k] === "number");

export async function POST(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ ok: false, saved: false, note: "Zugangscode fehlt oder falsch – nicht gespeichert" }, { status: 401 });
  try {
    const b = (await req.json()) as { cell?: string; baseParams?: Partial<LearnableParams>; base?: unknown; cand?: unknown; deployed?: Partial<LearnableParams> };
    if (!CELL_KEYS.includes(b.cell as CellKey) || !isMetrics(b.base) || !isMetrics(b.cand) || !b.deployed) return NextResponse.json({ ok: false, saved: false, note: "Ungültige Daten" }, { status: 400 });
    const out = await serverCells.propose(b.cell as CellKey, {
      baseParams: { ...DEFAULT_PARAMS, ...(b.baseParams ?? {}) },
      base: b.base,
      cand: b.cand,
      deployed: { ...DEFAULT_PARAMS, ...b.deployed },
      source: "Browser-Training",
    });
    return NextResponse.json({ ok: true, saved: out.saved, note: out.message, reasons: out.decision.reasons, record: summary(out.record) });
  } catch (e) {
    return NextResponse.json({ ok: false, saved: false, note: (e as Error).message }, { status: 500 });
  }
}

const summary = (r: { cell: CellKey; current: Metrics | null; previous: Metrics | null; updatedAt: string; params: Partial<LearnableParams>; version: number }) => ({
  cell: r.cell,
  current: r.current,
  previous: r.previous,
  updatedAt: r.updatedAt,
  params: r.params,
  version: r.version,
});
