"use client";
// Bottom-Sheet für Detailansichten (Handy-typisch), schließen per Wischen nach unten, Taste oder Hintergrund.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { IconClose } from "./Icons";

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode }) {
  const [drag, setDrag] = useState(0);
  const start = useRef<number | null>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm" onClick={onClose} role="dialog" aria-modal="true">
      <div
        className="card relative flex max-h-[92dvh] w-full max-w-3xl flex-col rounded-b-none border-b-0 bg-[#0b0b0c]/95 pb-[var(--safe-bottom)]"
        style={{ transform: `translateY(${drag}px)`, transition: start.current == null ? "transform 0.2s" : "none" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between gap-2 px-4 pb-2 pt-2"
          onTouchStart={(e) => (start.current = e.touches[0].clientY)}
          onTouchMove={(e) => start.current != null && setDrag(Math.max(0, e.touches[0].clientY - start.current))}
          onTouchEnd={() => {
            if (drag > 110) onClose();
            start.current = null;
            setDrag(0);
          }}
        >
          <div className="absolute left-1/2 top-1.5 h-1.5 w-10 -translate-x-1/2 rounded-full bg-white/25" />
          <div className="mt-3 min-w-0 flex-1 truncate text-[17px] font-semibold text-stone-100">{title}</div>
          <button onClick={onClose} className="mt-2 flex h-11 w-11 items-center justify-center rounded-full text-stone-300 active:bg-white/10" aria-label="Schließen">
            <IconClose className="h-6 w-6" />
          </button>
        </div>
        <div className="overflow-y-auto overscroll-contain px-4 pb-6">{children}</div>
      </div>
    </div>
  );
}

/** Kleine Bestätigung als Sheet. */
export function ConfirmSheet({ open, title, text, confirm, onConfirm, onClose }: { open: boolean; title: string; text: ReactNode; confirm: string; onConfirm: () => void; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div className="space-y-4 text-[15px] text-stone-200">
        {text}
        <div className="flex gap-2">
          <button className="btn flex-1" onClick={onClose}>
            Abbrechen
          </button>
          <button
            className="btn-primary flex-1"
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirm}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
