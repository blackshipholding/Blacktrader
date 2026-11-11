// Getrennte Speicherung je Anlageklasse × Horizont (z. B. Schlüssel "trainer:krypto:kurz").
// Ein Datensatz enthält die gelernten Werte, den aktuellen und vorherigen Stand (unbekannte Daten),
// alle Versionen und ein kurzes Protokoll. Ein Lauf für eine Zelle verändert NIE eine andere Zelle.
import { DEFAULT_PARAMS, resolveParams, strictnessErrors, validateParams, type LearnableParams, type ParamSet } from "../analysis/params";
import { KIND_LABEL, type AssetKind, type Horizon } from "../types";
import { decide, primaryRate, type Decision, type Metrics } from "./engine";
import { CELL_KEYS, type CellKey } from "./universe";
import { describeChanges } from "./walkforward";
import { stepLimitErrors } from "./moves";

const KIND_KEY: Record<AssetKind, string> = { stock: "aktien", crypto: "krypto", commodity: "rohstoffe" };
const HORIZON_KEY: Record<Horizon, string> = { short: "kurz", medium: "mittel", long: "lang" };
const HORIZON_WORD: Record<Horizon, string> = { short: "kurzfristig", medium: "mittelfristig", long: "langfristig" };

export const cellStorageKey = (cell: CellKey) => {
  const [k, h] = cell.split(":") as [AssetKind, Horizon];
  return `trainer:${KIND_KEY[k]}:${HORIZON_KEY[h]}`;
};
export const cellName = (cell: CellKey) => {
  const [k, h] = cell.split(":") as [AssetKind, Horizon];
  return `${KIND_LABEL[k]} ${HORIZON_WORD[h]}`;
};

export interface CellVersion {
  id: number;
  savedAt: string;
  params: Partial<LearnableParams>;
  standing: Metrics | null;
  reason: string;
}

export interface CellRecord {
  cell: CellKey;
  /** Zähler, steigt bei jeder Änderung */
  rev: number;
  updatedAt: string;
  /** Gelernte Werte (nur Abweichungen vom Standard) */
  params: Partial<LearnableParams>;
  version: number;
  /** Stand auf unbekannten Daten (aktuell gespeichert) und der davor */
  current: Metrics | null;
  previous: Metrics | null;
  versions: CellVersion[];
  log: { date: string; kind: "gespeichert" | "verworfen" | "zurückgesetzt"; reason: string }[];
}

const MAX_VERSIONS = 30;
const MAX_LOG = 40;
const pct = (x: number) => `${(x * 100).toFixed(1).replace(".", ",")} %`;

export function emptyRecord(cell: CellKey): CellRecord {
  return { cell, rev: 0, updatedAt: new Date(0).toISOString(), params: {}, version: 1, current: null, previous: null, versions: [{ id: 1, savedAt: new Date(0).toISOString(), params: {}, standing: null, reason: "Standardwerte" }], log: [] };
}

export function diffFromDefault(p: LearnableParams): Partial<LearnableParams> {
  const out: Partial<LearnableParams> = {};
  for (const k of Object.keys(p) as (keyof LearnableParams)[]) if (JSON.stringify(p[k]) !== JSON.stringify(DEFAULT_PARAMS[k])) (out as Record<string, unknown>)[k] = p[k];
  return out;
}

export const recordParams = (rec: CellRecord): LearnableParams => {
  const [k, h] = rec.cell.split(":") as [AssetKind, Horizon];
  return resolveParams({ [rec.cell]: rec.params }, k, h);
};

export interface Proposal {
  /** Werte, gegen die verglichen wurde (müssen noch aktiv sein) */
  baseParams: LearnableParams;
  /** Stand dieser Werte auf unbekannten Daten */
  base: Metrics;
  /** Neuer Stand auf denselben unbekannten Daten */
  cand: Metrics;
  deployed: LearnableParams;
  source: string;
}

export interface ApplyOutcome {
  record: CellRecord;
  saved: boolean;
  message: string;
  decision: Decision;
}

/**
 * Speichern NUR, wenn besser: Ausgangswerte noch aktiv, gültige Werte, alle Strenge-Regeln (decide + nur strenger).
 * Schlechtere oder gleiche Stände verändern die gelernten Werte nie.
 */
export function applyProposal(rec: CellRecord, p: Proposal, now = new Date()): ApplyOutcome {
  const active = recordParams(rec);
  const d = decide(p.base, p.cand);
  if (JSON.stringify({ ...DEFAULT_PARAMS, ...p.baseParams }) !== JSON.stringify(active)) d.reasons.unshift("Ausgangsstand hat sich inzwischen geändert");
  d.reasons.push(...validateParams(p.deployed), ...strictnessErrors(active, p.deployed), ...stepLimitErrors(active, p.deployed));
  if (JSON.stringify(p.deployed) === JSON.stringify(active)) d.reasons.push("keine geänderten Werte");
  d.accept = d.reasons.length === 0;
  const r: CellRecord = { ...rec, versions: [...rec.versions], log: [...rec.log] };
  const date = now.toISOString();
  let message: string;
  if (d.accept) {
    const prevStand = rec.current ?? p.base;
    r.previous = prevStand;
    r.current = p.cand;
    r.params = diffFromDefault(p.deployed);
    r.version = Math.max(...rec.versions.map((v) => v.id)) + 1;
    r.versions.push({ id: r.version, savedAt: date, params: r.params, standing: p.cand, reason: `${p.source}: ${describeChanges(active, p.deployed)}` });
    if (r.versions.length > MAX_VERSIONS) r.versions.splice(1, r.versions.length - MAX_VERSIONS);
    message = `Gespeichert: ${cellName(rec.cell)} ${pct(primaryRate(prevStand))} → ${pct(primaryRate(p.cand))}`;
    r.log.unshift({ date, kind: "gespeichert", reason: message });
  } else {
    // Erste Messung merken (ohne Werte zu ändern), damit der Stand angezeigt werden kann
    if (!rec.current && d.reasons[0] !== "Ausgangsstand hat sich inzwischen geändert") r.current = p.base;
    message = `Keine Verbesserung (${pct(primaryRate(p.cand))}) – alter Stand bleibt`;
    r.log.unshift({ date, kind: "verworfen", reason: `${message}: ${d.reasons.join("; ")}` });
  }
  if (r.log.length > MAX_LOG) r.log.length = MAX_LOG;
  r.rev = rec.rev + 1;
  r.updatedAt = date;
  return { record: r, saved: d.accept, message, decision: d };
}

/** Zurück auf eine frühere Version dieser Zelle (Standard: die vorige). */
export function rollbackRecord(rec: CellRecord, to?: number): CellRecord | null {
  const idx = rec.versions.findIndex((v) => v.id === rec.version);
  const target = to != null ? rec.versions.find((v) => v.id === to) : rec.versions[idx - 1];
  if (!target || target.id === rec.version) return null;
  const date = new Date().toISOString();
  return {
    ...rec,
    params: target.params,
    version: target.id,
    previous: rec.current,
    current: target.standing,
    rev: rec.rev + 1,
    updatedAt: date,
    log: [{ date, kind: "zurückgesetzt" as const, reason: `Zurück auf Version ${target.id}` }, ...rec.log].slice(0, MAX_LOG),
  };
}

/** Kurzfassung einer Zelle für die App (Anzeige und Analyse-Werte). */
export interface CellSummary {
  cell: CellKey;
  params: Partial<LearnableParams>;
  current: Metrics | null;
  previous: Metrics | null;
  updatedAt: string;
  version: number;
}
export const summarize = (r: CellRecord): CellSummary => ({ cell: r.cell, params: r.params, current: r.current, previous: r.previous, updatedAt: r.updatedAt, version: r.version });

/** Gelernte Werte aller Zellen zusammensetzen (für die Analyse). Kennung = jüngste Änderung. */
export function assembleParamSet(records: CellRecord[]): { version: number; params: ParamSet; updated: Partial<Record<CellKey, string>>; cells: CellSummary[] } {
  const params: ParamSet = {};
  const updated: Partial<Record<CellKey, string>> = {};
  let version = 0;
  for (const r of records) {
    if (Object.keys(r.params).length) params[r.cell] = r.params;
    updated[r.cell] = r.updatedAt;
    version = Math.max(version, Date.parse(r.updatedAt) || 0);
  }
  return { version, params, updated, cells: records.map(summarize) };
}

/** Lokale Kopie und Server-Stand zusammenführen: je Zelle gewinnt der jüngere. */
export function mergeRecords<T extends { updatedAt: string }>(server: Partial<Record<CellKey, T>>, local: Partial<Record<CellKey, T>>): Partial<Record<CellKey, T>> {
  const out: Partial<Record<CellKey, T>> = {};
  for (const c of CELL_KEYS) {
    const a = server[c];
    const b = local[c];
    out[c] = !a ? b : !b ? a : Date.parse(b.updatedAt) > Date.parse(a.updatedAt) ? b : a;
    if (!out[c]) delete out[c];
  }
  return out;
}
