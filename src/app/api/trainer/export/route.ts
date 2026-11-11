// Alle Trainer-Ergebnisse als eine JSON-Datei (Stände je Klasse × Horizont, Versionen, Messprotokolle, Verlauf, Signal-Protokoll).
import { NextResponse } from "next/server";
import { loadAllCells, loadProtocol } from "@/lib/trainer/cellStore";
import { loadSignals, loadState } from "@/lib/trainer/server";
import { getJson, storageKind } from "@/lib/trainer/storage";
import { CELL_KEYS } from "@/lib/trainer/universe";

export const dynamic = "force-dynamic";

export async function GET() {
  const [cells, protocols, state, signals, echochart, tournament] = await Promise.all([loadAllCells(), Promise.all(CELL_KEYS.map(loadProtocol)), loadState(), loadSignals(), getJson<unknown[]>("trainer:echochart"), getJson<unknown[]>("trainer:tournament")]);
  const body = {
    exportedAt: new Date().toISOString(),
    storage: storageKind(),
    cells,
    protocols: protocols.filter(Boolean),
    log: state.log,
    history: state.history,
    finalTests: state.finalTests,
    lastRun: state.lastRun,
    signals,
    echochart: echochart ?? [],
    tournament: tournament ?? [],
  };
  return new NextResponse(JSON.stringify(body, null, 1), {
    headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="trainer-export-${body.exportedAt.slice(0, 10)}.json"`, "Cache-Control": "no-store" },
  });
}
