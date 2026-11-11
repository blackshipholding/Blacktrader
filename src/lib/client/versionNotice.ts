"use client";
// Regelwerk C2/C3: neue Lern-Versionen anzeigen (bis „gesehen“) und Rückweg auf die vorige Version.
import { cellSummary } from "./trainerParams";
import { TOKEN_KEY } from "./trainingSession";
import { CELL_KEYS, type CellKey } from "../trainer/universe";

const SEEN_KEY = "bt-seen-versions";

function readSeen(): Partial<Record<CellKey, number>> {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) ?? "{}");
  } catch {
    return {};
  }
}

export interface VersionInfo {
  cell: CellKey;
  version: number;
  updatedAt: string;
}

/** Bereiche mit gelernten Versionen (Version > 1) */
export function cellVersions(): VersionInfo[] {
  return CELL_KEYS.map((cell) => {
    const s = cellSummary(cell);
    return s && s.version > 1 ? { cell, version: s.version, updatedAt: s.updatedAt } : null;
  }).filter((x): x is VersionInfo => !!x);
}

/** Neue Versionen seit dem letzten „gesehen“ (beim ersten Mal: keine – alles gilt als bekannt) */
export function newVersions(): VersionInfo[] {
  const seen = readSeen();
  if (!Object.keys(seen).length) return [];
  return cellVersions().filter((v) => v.version > (seen[v.cell] ?? 1));
}

export function markVersionsSeen() {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(Object.fromEntries(CELL_KEYS.map((c) => [c, cellSummary(c)?.version ?? 1]))));
  } catch {
    /* ohne Speicher */
  }
}

/** Beim ersten Aufruf (sobald die Bereiche geladen sind): aktuellen Stand als bekannt merken */
export function initVersionsSeen() {
  if (!CELL_KEYS.some((c) => cellSummary(c))) return;
  try {
    if (!localStorage.getItem(SEEN_KEY)) markVersionsSeen();
  } catch {
    /* ohne Speicher */
  }
}

/** C3: Rückweg-Vorschlag – Bereiche, die seit Beginn der Live-Bilanz neu gelernt wurden */
export function rollbackCandidates(liveStart: number | null): VersionInfo[] {
  if (!liveStart) return [];
  return cellVersions().filter((v) => Date.parse(v.updatedAt) / 1000 >= liveStart);
}

/** Einen Bereich auf die vorige Version zurücksetzen (braucht den Zugangscode) */
export async function rollbackToPrevious(cell: CellKey): Promise<{ ok: boolean; note: string }> {
  let token = "";
  try {
    token = localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    /* ohne Speicher */
  }
  try {
    const r = await fetch("/api/trainer/rollback", { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { "x-trainer-token": token } : {}) }, body: JSON.stringify({ cell }) });
    const j = (await r.json().catch(() => ({}))) as { ok?: boolean; note?: string };
    return { ok: !!j.ok, note: j.note ?? (r.ok ? "Zurückgesetzt" : "Fehlgeschlagen") };
  } catch {
    return { ok: false, note: "Server nicht erreichbar" };
  }
}
