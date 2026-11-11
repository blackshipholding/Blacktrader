"use client";
import { useState } from "react";
import type { LiveStatus } from "@/lib/client/market";

const TEXT: Record<LiveStatus, { label: string; dot: string; info: string }> = {
  live: { label: "Live", dot: "bg-emerald-400", info: "Echtzeit-Kurs (Binance-WebSocket bzw. aktueller Börsenkurs)." },
  delayed: { label: "Verzögert", dot: "bg-amber-400", info: "Kurs bis zu 15 Min. verzögert (kostenlose Börsendaten)." },
  offline: { label: "Offline", dot: "bg-red-500", info: "Keine Verbindung zur Datenquelle – es wird der letzte bekannte Kurs gezeigt." },
  loading: { label: "Lädt", dot: "bg-stone-500 animate-pulse", info: "Kurs wird geladen." },
};

/** Status mit Erklärung (Antippen bzw. Tooltip). */
export function StatusPill({ status, source }: { status?: LiveStatus; source?: string }) {
  const [open, setOpen] = useState(false);
  const t = TEXT[status ?? "loading"];
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
        title={t.info}
        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-1 text-[13px] text-stone-300"
        aria-label={`${t.label}: ${t.info}`}
      >
        <span className={`h-2 w-2 rounded-full ${t.dot}`} />
        {t.label}
      </button>
      {open && (
        <span className="absolute right-0 top-full z-20 mt-1 w-56 rounded-xl border border-white/10 bg-black/95 p-2.5 text-[13px] text-stone-200 shadow-xl">
          {t.info}
          {source ? <span className="mt-1 block text-stone-500">Quelle: {source}</span> : null}
        </span>
      )}
    </span>
  );
}
