"use client";
// Gelernte Werte des Trainers – je Anlageklasse × Horizont getrennt.
// Quelle: Server (für alle gleich) + lokale Kopie je Zelle auf diesem Gerät. Je Zelle gilt der jüngere Stand.
import { useSyncExternalStore } from "react";
import { clampWeights, resolveParams, validateParams, validateWeights, type LearnableParams, type ParamSet, type WeightSet } from "../analysis/params";
import { cellStorageKey, mergeRecords, type CellSummary } from "../trainer/cells";
import { CELL_KEYS, type CellKey } from "../trainer/universe";
import type { AssetKind, Horizon } from "../types";

type CellMap = Partial<Record<CellKey, CellSummary>>;
let server: CellMap = {};
let local: CellMap = {};
let merged: CellMap = {};
let stamp = 0;
const subs = new Set<() => void>();
const LOCAL_PREFIX = "bsh-";

/** Nur gültige, lernbare Werte übernehmen (gesperrte Werte können so nie ankommen). */
function clean(x: unknown, cell: CellKey): CellSummary | null {
  if (!x || typeof x !== "object") return null;
  const r = x as CellSummary;
  if (r.cell !== cell || typeof r.updatedAt !== "string" || !r.params || typeof r.params !== "object") return null;
  if (validateParams(r.params).length) return null;
  return { cell, params: r.params, current: r.current ?? null, previous: r.previous ?? null, updatedAt: r.updatedAt, version: Number(r.version) || 1 };
}

function recompute() {
  merged = mergeRecords(server, local);
  stamp = Math.max(0, ...Object.values(merged).map((r) => Date.parse(r!.updatedAt) || 0));
  subs.forEach((f) => f());
}

function readLocal() {
  const out: CellMap = {};
  try {
    for (const c of CELL_KEYS) {
      const raw = localStorage.getItem(LOCAL_PREFIX + cellStorageKey(c));
      const r = raw ? clean(JSON.parse(raw), c) : null;
      if (r) out[c] = r;
    }
  } catch {
    /* ohne Speicher */
  }
  local = out;
}
if (typeof window !== "undefined") {
  readLocal();
  // Alte gemeinsame Kopie (vor der Trennung) wird nicht mehr verwendet
  try {
    localStorage.removeItem("bsh-trainer-params");
  } catch {
    /* egal */
  }
  recompute();
}

/** Lokale Kopie EINER Zelle speichern (eigener Schlüssel – andere Zellen bleiben unberührt). */
export function saveLocalCell(r: CellSummary) {
  const c = clean(r, r.cell);
  if (!c) return;
  try {
    localStorage.setItem(LOCAL_PREFIX + cellStorageKey(r.cell), JSON.stringify(c));
  } catch {
    /* Speicher voll */
  }
  local = { ...local, [r.cell]: c };
  recompute();
}

let loading: Promise<void> | null = null;
export function refreshTrainerParams(force = false): Promise<void> {
  if (force) loading = null;
  loading ??= fetch(force ? `/api/trainer/params?t=${Date.now()}` : "/api/trainer/params", force ? { cache: "no-store" } : undefined)
    .then((r) => (r.ok ? r.json() : null))
    .then((j: { cells?: unknown[] } | null) => {
      if (!j || !Array.isArray(j.cells)) return;
      const next: CellMap = {};
      for (const x of j.cells) {
        const cell = (x as CellSummary)?.cell;
        const r = CELL_KEYS.includes(cell) ? clean(x, cell) : null;
        if (r) next[cell] = r;
      }
      server = next;
      readLocal();
      recompute();
    })
    .catch(() => {})
    .finally(() => {
      setTimeout(() => (loading = null), 5 * 60e3);
    });
  return loading;
}

export const trainerVersion = () => stamp;
export const cellSummary = (cell: CellKey): CellSummary | undefined => merged[cell];
export function trainerParamSet(): { version: number; params: ParamSet } {
  const params: ParamSet = {};
  for (const [c, r] of Object.entries(merged)) if (r && Object.keys(r.params).length) params[c as CellKey] = r.params;
  return { version: stamp, params };
}
export function learnedParams(kind: AssetKind | undefined, horizon: Horizon): LearnableParams {
  return resolveParams(trainerParamSet().params, kind, horizon);
}

/** Gewichtung, die die Analyse verwendet: eigene (manuell, begrenzt) oder die vom Trainer gelernte. */
export function effectiveWeights(settings: { weights: WeightSet; weightsMode?: "trainer" | "manual" }, kind: AssetKind | undefined, horizon: Horizon): WeightSet {
  if (settings.weightsMode === "manual") return validateWeights(settings.weights).length ? clampWeights(settings.weights, "elliott") : settings.weights;
  return learnedParams(kind, horizon).weights;
}

const subscribe = (f: () => void) => {
  subs.add(f);
  return () => subs.delete(f);
};
export function useTrainerVersion(): number {
  return useSyncExternalStore(subscribe, () => stamp, () => 0);
}
/** Alle Zellen (zusammengeführt) – für die Trainer-Anzeige. */
export function useTrainerCells(): CellMap {
  return useSyncExternalStore(subscribe, () => merged, () => EMPTY); // Server-Render und erstes Hydrieren: leer
}
const EMPTY: CellMap = {};


/** Vom Trainer gelernte Gewichtungen je Klasse/Horizont (nur Abweichungen vom Standard). */
export function learnedWeightCells(): { cell: string; weights: WeightSet }[] {
  return Object.values(merged)
    .filter((r) => r?.params.weights)
    .map((r) => ({ cell: r!.cell, weights: r!.params.weights! }));
}
