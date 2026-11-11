"use client";
// Service Worker registrieren und Updates erkennen: Ist auf dem Server eine neuere Version, lädt sich die App
// beim nächsten Zurückkehren (oder sofort, wenn sie gerade sichtbar ist und nichts eingegeben wird) neu.
import { useEffect } from "react";

const MINE = process.env.NEXT_PUBLIC_BUILD_ID ?? "";

async function newerVersion(): Promise<boolean> {
  try {
    const r = await fetch("/api/version", { cache: "no-store" });
    if (!r.ok) return false;
    const { build } = (await r.json()) as { build?: string };
    return !!build && !!MINE && build !== MINE;
  } catch {
    return false;
  }
}

export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    let pending = false;
    const reload = () => {
      // Nicht mitten in einer Eingabe neu laden
      const a = document.activeElement;
      if (a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT")) return;
      try {
        // Nicht während eines laufenden Trainings (wird sonst neu begonnen) und höchstens alle 2 Minuten
        const st = JSON.parse(localStorage.getItem("bsh-training-session") ?? "null") as { status?: string } | null;
        if (st?.status === "running") return;
        const last = Number(sessionStorage.getItem("bt-reload-at") ?? 0);
        if (Date.now() - last < 120e3) return;
        sessionStorage.setItem("bt-reload-at", String(Date.now()));
      } catch {
        /* ohne Speicher: trotzdem neu laden */
      }
      navigator.serviceWorker?.getRegistration().then((r) => r?.update()).catch(() => {});
      location.reload();
    };
    const check = async () => {
      if (pending || (await newerVersion())) {
        pending = true;
        if (document.visibilityState === "visible") reload();
      }
    };
    const onVis = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVis);
    const t = setInterval(check, 3 * 60e3);
    void check();
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      clearInterval(t);
    };
  }, []);
  return null;
}
