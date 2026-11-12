"use client";
// Kerzen-Zwischenspeicher über das Neuladen hinaus (IndexedDB): Tages- und Wochenkerzen für die Suche bleiben 15 Minuten
// gültig (so lange gilt auch ein Suchergebnis). Es werden dieselben vollständigen Daten wie vom Server verwendet –
// nichts wird verkürzt oder übersprungen; nach Ablauf wird neu geladen.
const DB = "bt-cache";
const STORE = "candles";
export const CACHE_MS = 15 * 60e3;

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const q = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      q.onsuccess = () => {
        const v = q.result as { t: number; v: T } | undefined;
        resolve(v && Date.now() - v.t < CACHE_MS ? v.v : null);
      };
      q.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function cacheSet(key: string, value: unknown): Promise<void> {
  const db = await open();
  if (!db) return;
  try {
    db.transaction(STORE, "readwrite").objectStore(STORE).put({ t: Date.now(), v: value }, key);
  } catch {
    /* Speicher voll – dann eben ohne Zwischenspeicher */
  }
}
