"use client";
// Varianten-Messung (Nutzer 14.11.2026): Hat der Trainer eine bessere Variante gefunden, die alle Prüfungen (inkl. 5 Prüftage) besteht,
// wird sie NICHT mehr zum Einbauen vorgeschlagen. Stattdessen:
//  – Die sichtbare Live-Bilanz wird auf null gesetzt und misst ab jetzt die neue Variante („Kandidat“), parallel zur Suche.
//  – Die bisherige (offizielle) Variante läuft in einer eigenen, unsichtbaren Liste weiter (nur im Download sichtbar) – zum Vergleich.
//  – Im Training bleibt die neue Variante der Ausgangspunkt, bis du entschieden hast.
//  – Nach 100 abgeschlossenen Ergebnissen fragt die Live-Bilanz: übernehmen? Ja = offiziell, Nummer +0,1 (0.2 → 0.3 …), überall.
// Deine Chancen-Liste und der Handel bleiben bis zu deinem „Ja“ bei der bisherigen Variante.
import { useSyncExternalStore } from "react";
import type { LearnableParams, ParamSet } from "../analysis/params";
import { diffFromDefault } from "../trainer/cells";
import type { Metrics } from "../trainer/engine";
import type { CellKey } from "../trainer/universe";
import { actions, getData } from "../store/store";
import type { ChanceLogEntry, LogStore } from "./chanceLog";

export const TRIAL_TARGET = 100;
const TRIAL_KEY = "bt-trial-v1";
const OLD_KEY = "bt-trial-oldlog-v1";
const ARCHIVE_KEY = "bt-trial-archive-v1";

export interface TrialCell {
  params: LearnableParams;
  baseParams: LearnableParams;
  base: Metrics;
  cand: Metrics;
  changes: string;
}
export interface Trial {
  id: string;
  startedAt: number;
  /** Version der bisherigen Variante (zur Beschriftung des Archivs) */
  oldVersion: string;
  cells: Partial<Record<CellKey, TrialCell>>;
  /** Meldung „100 Ergebnisse erreicht“ schon gesendet */
  notified?: boolean;
}

const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const rd = <T,>(k: string, d: T): T => {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : d;
  } catch {
    return d;
  }
};
const wr = (k: string, v: unknown) => {
  try {
    if (v == null) localStorage.removeItem(k);
    else localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* Speicher voll */
  }
};

let cache: Trial | null | undefined;
export const getTrial = (): Trial | null => (cache === undefined ? (cache = rd<Trial | null>(TRIAL_KEY, null)) : cache);
const saveTrial = (t: Trial | null) => {
  cache = t;
  wr(TRIAL_KEY, t);
  emit();
};
export const trialActive = () => getTrial() != null;
export const useTrial = (): Trial | null =>
  useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), getTrial, () => null);

/** Abgeschlossene Ergebnisse (Ziel oder Stop) einer Liste */
export const doneCount = (log: ChanceLogEntry[]) => log.filter((x) => x.result === "ziel" || x.result === "stop").length;
export const trialReady = (t: Trial | null, log: ChanceLogEntry[]) => !!t && doneCount(log) >= TRIAL_TARGET;

/** Die bisherige (offizielle) Variante läuft während der Messung hier weiter */
export const getOldLog = (): ChanceLogEntry[] => rd<ChanceLogEntry[]>(OLD_KEY, []);
export const oldStore = (): LogStore => ({ get: getOldLog, set: (l) => wr(OLD_KEY, l), warn: false });

export const getArchive = (): { version: string; at: number; log: ChanceLogEntry[] }[] => rd(ARCHIVE_KEY, []);
export function archiveOldLog(version: string) {
  wr(ARCHIVE_KEY, [...getArchive(), { version, at: Date.now(), log: getOldLog() }].slice(-5));
  wr(OLD_KEY, null);
}

/** Param-Satz fürs Training: Kandidat überlagert den offiziellen Stand (solange eine Messung läuft) */
export function overlayParams(params: ParamSet): ParamSet {
  const t = getTrial();
  if (!t) return params;
  const out: ParamSet = { ...params };
  for (const [c, x] of Object.entries(t.cells)) if (x) out[c as CellKey] = diffFromDefault(x.params);
  return out;
}

/** Messung starten: Live-Bilanz sichern (alte Variante läuft unsichtbar weiter) und auf null setzen */
export function startTrial(cells: Trial["cells"], oldVersion: string): Trial {
  const t: Trial = { id: String(Date.now()), startedAt: Date.now(), oldVersion, cells };
  wr(OLD_KEY, getData().chanceLog);
  actions.setChanceLog([]);
  saveTrial(t);
  return t;
}

export function markNotified() {
  const t = getTrial();
  if (t && !t.notified) saveTrial({ ...t, notified: true });
}

/** Messung beenden. `restoreOld`: die bisherige Variante bekommt ihre Live-Bilanz zurück (Antwort „Nein“) */
export function endTrial(restoreOld: boolean) {
  if (restoreOld) actions.setChanceLog(getOldLog());
  wr(OLD_KEY, null);
  saveTrial(null);
}
