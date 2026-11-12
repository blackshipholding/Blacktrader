"use client";
// Gelernter Stop (Shipmaster 0.2): Der Trainer speichert hier, was Prüfung B8 bestanden hat. Immer innerhalb des engen
// Rahmens (STOP_RANGE) – nie extreme Werte; die Oberkante bleibt die Untergrenze. Ohne gelernten Wert gilt DEFAULT_STOP.
import { DEFAULT_STOP, STOP_RANGE, type StopParams } from "../analysis/longterm";

const KEY = "bt-stop-params";
const clamp = (x: number, [a, b]: readonly [number, number]) => Math.min(b, Math.max(a, x));

/** Werte in den erlaubten Rahmen zwingen */
export function sanitizeStop(p: Partial<StopParams> | null | undefined): StopParams {
  const w = Number(p?.trailWeeks);
  const weeks = (STOP_RANGE.trailWeeks as readonly number[]).includes(w) ? w : DEFAULT_STOP.trailWeeks;
  return { gain: clamp(Number(p?.gain ?? DEFAULT_STOP.gain) || DEFAULT_STOP.gain, STOP_RANGE.gain), trailWeeks: weeks, step: clamp(Number(p?.step ?? DEFAULT_STOP.step) || DEFAULT_STOP.step, STOP_RANGE.step) };
}

export function getStopParams(): StopParams {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? sanitizeStop(JSON.parse(raw)) : DEFAULT_STOP;
  } catch {
    return DEFAULT_STOP;
  }
}

export function saveStopParams(p: StopParams): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(sanitizeStop(p)));
  } catch {
    /* ohne Speicher */
  }
}
