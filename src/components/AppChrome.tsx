"use client";
// App-Hülle: Offline-Hinweis, "Zum Startbildschirm"-Hinweis, Pull-to-Refresh.
import { useEffect, useRef, useState } from "react";
import { useMarket } from "@/lib/client/market";
import { IconClose } from "./Icons";

const INSTALL_KEY = "bsh-install-hint-dismissed";

export function OfflineBanner() {
  const [offline, setOffline] = useState(false);
  const [since, setSince] = useState<string | null>(null);
  useEffect(() => {
    const update = () => {
      const off = !navigator.onLine;
      setOffline(off);
      if (off) setSince(new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }));
    };
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  if (!offline) return null;
  return <div className="sticky top-[calc(var(--header-h)+var(--safe-top))] z-30 bg-amber-500/90 px-4 py-1.5 text-center text-[14px] font-medium text-black">Offline – letzter Stand {since}</div>;
}

interface BIPEvent extends Event {
  prompt: () => Promise<void>;
}

/** Einmaliger Hinweis "Zum Startbildschirm hinzufügen" (Android: Installations-Dialog, iPhone: Anleitung). */
export function InstallHint() {
  const [show, setShow] = useState(false);
  const [ios, setIos] = useState(false);
  const evt = useRef<BIPEvent | null>(null);
  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone;
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(INSTALL_KEY) === "1";
    } catch {
      /* ignorieren */
    }
    if (standalone || dismissed) return;
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    setIos(isIos);
    if (isIos) setShow(true);
    const onPrompt = (e: Event) => {
      e.preventDefault();
      evt.current = e as BIPEvent;
      setShow(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);
  const close = () => {
    setShow(false);
    try {
      localStorage.setItem(INSTALL_KEY, "1");
    } catch {
      /* ignorieren */
    }
  };
  if (!show) return null;
  return (
    <div className="fixed inset-x-3 bottom-[calc(var(--nav-h)+var(--safe-bottom)+10px)] z-50 mx-auto max-w-md">
      <div className="card flex items-start gap-3 p-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon-192.png" alt="" className="h-11 w-11 rounded-xl" />
        <div className="flex-1 text-[15px]">
          <p className="font-semibold text-stone-100">App auf den Startbildschirm</p>
          <p className="text-stone-400">{ios ? "Tippe unten auf „Teilen“ und dann auf „Zum Home-Bildschirm“." : "Installieren für Vollbild und schnellen Zugriff."}</p>
          {!ios && (
            <button
              className="btn-primary mt-2"
              onClick={async () => {
                await evt.current?.prompt();
                close();
              }}
            >
              Installieren
            </button>
          )}
        </div>
        <button onClick={close} className="-m-2 flex h-11 w-11 items-center justify-center text-stone-400" aria-label="Hinweis schließen">
          <IconClose className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}

/** Pull-to-Refresh: am Seitenanfang nach unten ziehen lädt Kurse und Analysen neu. */
export function PullToRefresh() {
  const { refresh } = useMarket();
  const [pull, setPull] = useState(0);
  const start = useRef<number | null>(null);
  useEffect(() => {
    const down = (e: TouchEvent) => {
      start.current = window.scrollY <= 0 ? e.touches[0].clientY : null;
    };
    const move = (e: TouchEvent) => {
      if (start.current == null) return;
      const d = e.touches[0].clientY - start.current;
      setPull(d > 0 ? Math.min(d, 120) : 0);
    };
    const up = () => {
      if (pull > 80) {
        refresh();
        if ("vibrate" in navigator) navigator.vibrate(15);
      }
      start.current = null;
      setPull(0);
    };
    window.addEventListener("touchstart", down, { passive: true });
    window.addEventListener("touchmove", move, { passive: true });
    window.addEventListener("touchend", up);
    return () => {
      window.removeEventListener("touchstart", down);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", up);
    };
  }, [pull, refresh]);
  if (pull < 10) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[calc(var(--header-h)+var(--safe-top)+8px)] z-30 flex justify-center">
      <div className="card px-4 py-1.5 text-[13px] text-stone-300" style={{ opacity: Math.min(1, pull / 80) }}>
        {pull > 80 ? "Loslassen zum Aktualisieren" : "Zum Aktualisieren ziehen"}
      </div>
    </div>
  );
}
