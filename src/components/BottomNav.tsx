"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconBook, IconHome, IconList, IconMore, IconSpark } from "./Icons";

const NAV = [
  { href: "/", label: "Übersicht", Icon: IconHome, match: (p: string) => p === "/" },
  { href: "/chancen", label: "Chancen", Icon: IconSpark, match: (p: string) => p.startsWith("/chancen") },
  { href: "/watchlist", label: "Watchlist", Icon: IconList, match: (p: string) => p.startsWith("/watchlist") || p.startsWith("/analyse") },
  { href: "/depot", label: "Depot", Icon: IconBook, match: (p: string) => p.startsWith("/depot") || p.startsWith("/journal") },
  { href: "/mehr", label: "Mehr", Icon: IconMore, match: (p: string) => ["/mehr", "/echochart", "/einstellungen", "/trainer"].some((x) => p.startsWith(x)) },
];

/** Feste Navigation unten in der Daumenzone. */
export function BottomNav() {
  const path = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-[rgba(176,138,79,0.3)] bg-black/85 pb-[var(--safe-bottom)] backdrop-blur-xl" aria-label="Hauptnavigation">
      <ul className="mx-auto grid h-[var(--nav-h)] max-w-3xl grid-cols-5">
        {NAV.map(({ href, label, Icon, match }) => {
          const active = match(path);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex h-full min-h-[44px] flex-col items-center justify-center gap-0.5 text-[13px] transition ${active ? "text-gold" : "text-stone-400 active:text-stone-200"}`}
              >
                <Icon className="h-6 w-6" />
                <span className="font-medium">{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
